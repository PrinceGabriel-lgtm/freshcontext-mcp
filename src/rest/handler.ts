import { evaluateSignal, evaluateSignals } from "../core/index.js";
import type {
  CoreSignalEvaluationOptions,
  FreshContextSignalInput,
} from "../core/index.js";

const SERVICE_VERSION = "0.5.1";
const JSON_CONTENT_TYPE = "application/json";
const MAX_BODY_BYTES = 256 * 1024;

// Ledger-backed verify (Mode 2). Bound the verdict_id fan-out so a hot verdict_id
// can never trigger an unbounded scan; matched_rows_capped flags when we hit it.
const LEDGER_LOOKUP_LIMIT = 50;
const VERDICT_ID_RE = /^[0-9a-f]{64}$/;

// Minimal structural view of the database read surface Mode 2 needs. Declared here
// so handler.ts stays free of edge-only Worker types (the concrete database binding
// type) — this file compiles under the root Core/npm tsconfig and ships in the npm
// package, which must not depend on edge-only types. The Worker's env.DB is
// structurally compatible and passes with no cast.
export interface LedgerReader {
  prepare(query: string): {
    bind(...values: unknown[]): {
      all<T = unknown>(): Promise<{ results: T[] }>;
    };
  };
}

interface SnapshotRow {
  signing_payload: string;
  signature: string;
  engine_version: string;
  evaluated_at: string;
  signature_version: string;
}

type HaPriSignatureVersion =
  | "FRESHCONTEXT_HA_PRI_V2"
  | "FRESHCONTEXT_HA_PRI_V3"
  | "FRESHCONTEXT_HA_PRI_V4";

const HA_PRI_V4 = "FRESHCONTEXT_HA_PRI_V4";
const ED25519 = "Ed25519";

// Resolves a key_id to its published SPKI public key (base64). Injected call-scoped,
// exactly as hmacSecret and ledger are: handler.ts ships in the npm package and must
// not import edge-only modules or hold key material of its own.
export type PublicKeyResolver = (keyId: string) => string | undefined | Promise<string | undefined>;

type RestErrorCode =
  | "invalid_request"
  | "method_not_allowed"
  | "unsupported_media_type"
  | "payload_too_large"
  | "not_found"
  | "internal_error";

type JsonRecord = Record<string, unknown>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": JSON_CONTENT_TYPE },
  });
}

function errorResponse(code: RestErrorCode, message: string, status: number, details: unknown[] = []): Response {
  return jsonResponse({ error: { code, message, details } }, status);
}

function methodNotAllowed(allowed: string): Response {
  return new Response(
    JSON.stringify({
      error: {
        code: "method_not_allowed",
        message: `Method not allowed. Use ${allowed}.`,
        details: [],
      },
    }),
    {
      status: 405,
      headers: {
        "Content-Type": JSON_CONTENT_TYPE,
        "Allow": allowed,
      },
    }
  );
}

function isJsonContentType(request: Request): boolean {
  return (request.headers.get("Content-Type") ?? "").toLowerCase().includes(JSON_CONTENT_TYPE);
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJsonBody(request: Request): Promise<{ ok: true; body: JsonRecord } | { ok: false; response: Response }> {
  if (!isJsonContentType(request)) {
    return {
      ok: false,
      response: errorResponse("unsupported_media_type", "POST requests require Content-Type: application/json.", 415),
    };
  }

  const contentLength = request.headers.get("Content-Length");
  if (contentLength !== null && Number(contentLength) > MAX_BODY_BYTES) {
    return {
      ok: false,
      response: errorResponse("payload_too_large", `Request body exceeds ${MAX_BODY_BYTES} bytes.`, 413),
    };
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    return {
      ok: false,
      response: errorResponse("payload_too_large", `Request body exceeds ${MAX_BODY_BYTES} bytes.`, 413),
    };
  }

  try {
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed)) {
      return {
        ok: false,
        response: errorResponse("invalid_request", "Request body must be a JSON object.", 400),
      };
    }
    return { ok: true, body: parsed };
  } catch {
    return {
      ok: false,
      response: errorResponse("invalid_request", "Request body must be valid JSON.", 400),
    };
  }
}

function optionsFromBody(body: JsonRecord): CoreSignalEvaluationOptions | undefined {
  if (body.options === undefined) return undefined;
  return isRecord(body.options) ? body.options as CoreSignalEvaluationOptions : {};
}

async function handleEvaluate(request: Request): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed("POST");

  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;

  if (!isRecord(parsed.body.signal)) {
    return errorResponse("invalid_request", "Request body must include signal.", 400);
  }

  const result = evaluateSignal(
    parsed.body.signal as unknown as FreshContextSignalInput,
    optionsFromBody(parsed.body)
  );
  return jsonResponse(result);
}

async function handleEvaluateBatch(request: Request): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed("POST");

  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;

  if (!Array.isArray(parsed.body.signals)) {
    return errorResponse("invalid_request", "Request body must include signals array.", 400);
  }

  const result = evaluateSignals(
    parsed.body.signals as unknown as FreshContextSignalInput[],
    optionsFromBody(parsed.body)
  );
  return jsonResponse({ evaluations: result });
}

function handleHealth(request: Request): Response {
  if (request.method !== "GET") return methodNotAllowed("GET");
  return jsonResponse({
    ok: true,
    service: "freshcontext-rest",
    version: SERVICE_VERSION,
    core_available: true,
  });
}

async function hmacHex(key: string, payload: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const buf = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Timing-safe equality for the signature compare. Instead of comparing the two hex
// strings directly (=== short-circuits at the first differing byte → a timing oracle
// an attacker could walk one byte at a time), we HMAC BOTH sides under the same secret
// already in scope and compare the resulting MAC bytes in a fixed-time XOR loop. The
// compare runs over unpredictable MAC bytes, so byte-position leakage reveals nothing
// about the real signature. Kept Web-Crypto-only so handler.ts stays edge-safe and free
// of the npm/edge boundary (worker.ts has its own constantTimeEqual for the API-key path;
// importing it here would drag in a Worker-only module this file deliberately avoids).
async function timingSafeEqualHex(hmacSecret: string, a: string, b: string): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(hmacSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const enc = new TextEncoder();
  const [macA, macB] = await Promise.all([
    crypto.subtle.sign("HMAC", key, enc.encode(a)),
    crypto.subtle.sign("HMAC", key, enc.encode(b)),
  ]);
  const ua = new Uint8Array(macA);
  const ub = new Uint8Array(macB);
  let diff = ua.length ^ ub.length;
  for (let i = 0; i < ua.length; i++) diff |= ua[i] ^ (ub[i] ?? 0);
  return diff === 0;
}

// Base64 (standard or URL-safe) to bytes, without atob or Buffer. handler.ts runs both
// on Node and on the edge and is compiled under a DOM-free lib, so it leans on neither.
const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function base64ToBytes(input: string): Uint8Array<ArrayBuffer> | null {
  const clean = input.trim().replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/g, "");
  const out = new Uint8Array(Math.floor((clean.length * 6) / 8));
  let bits = 0;
  let acc = 0;
  let written = 0;
  for (const ch of clean) {
    const index = B64_ALPHABET.indexOf(ch);
    if (index < 0) return null; // Not base64 — an invalid signature, not a crash.
    acc = (acc << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[written++] = (acc >> bits) & 0xff;
    }
  }
  return out.subarray(0, written) as Uint8Array<ArrayBuffer>;
}

// Ed25519 verification. Constant-time by construction, so unlike the HMAC path there is
// no double-MAC compare to do here. Any malformed input verifies as false rather than
// throwing: a bad signature is an answer, not an error.
async function verifyEd25519(
  publicKeySpkiB64: string,
  payload: string,
  signatureB64: string
): Promise<boolean> {
  const signature = base64ToBytes(signatureB64);
  const spki = base64ToBytes(publicKeySpkiB64);
  if (!signature || !spki) return false;
  try {
    const key = await crypto.subtle.importKey("spki", spki, { name: ED25519 }, false, ["verify"]);
    return await crypto.subtle.verify(ED25519, key, signature, new TextEncoder().encode(payload));
  } catch {
    return false;
  }
}

// key_id is carried INSIDE the signed payload, so it is covered by the signature and
// therefore tamper-evident — swapping it to another published key breaks verification
// rather than silently verifying under the wrong key.
function keyIdFromV4Payload(payload: string): string | null {
  const lines = payload.split(/\r?\n/);
  if (lines[0] !== HA_PRI_V4) return null;
  if (!lines.includes(`signature_algorithm=${ED25519}`)) return null;
  const line = lines.find((l) => l.startsWith("key_id="));
  const keyId = line?.slice("key_id=".length) ?? "";
  return keyId === "" ? null : keyId;
}

// Verify a stored/presented payload against its signature, choosing the scheme from the
// payload's own version rather than assuming one.
//
// This branch is not optional. Before it existed, verifyRow recomputed HMAC over every
// row unconditionally — so the moment the writer began storing V4 rows, a verdict_id
// lookup would have HMAC'd an Ed25519 signature, seen a mismatch, and reported a
// perfectly good verdict as "invalid". Confidently wrong, which is the one outcome this
// ledger exists to avoid.
async function verifyRow(
  row: SnapshotRow,
  hmacSecret: string | undefined,
  extra: JsonRecord,
  resolvePublicKey?: PublicKeyResolver
): Promise<Response> {
  const base = {
    ...extra,
    evaluated_at: row.evaluated_at,
    engine_version: row.engine_version,
    signature_version: row.signature_version,
  };

  if (row.signature_version === HA_PRI_V4) {
    const keyId = keyIdFromV4Payload(row.signing_payload);
    if (!keyId) {
      return jsonResponse({
        status: "invalid", ...base, verification_method: "ed25519",
        reasons: ["stored payload is labelled V4 but carries no usable key_id"],
      });
    }
    const publicKey = resolvePublicKey ? await resolvePublicKey(keyId) : undefined;
    if (!publicKey) {
      // Explicitly NOT an HMAC fallback. An unknown key_id is unknown, never "invalid"
      // and never quietly re-checked under the shared secret.
      return jsonResponse({
        status: "unknown", ...base, key_id: keyId, verification_method: "ed25519",
        reasons: [`no published verification key for key_id=${keyId}`],
      });
    }
    const valid = await verifyEd25519(publicKey, row.signing_payload, row.signature);
    return jsonResponse({
      status: valid ? "valid" : "invalid", ...base, key_id: keyId,
      verification_method: "ed25519",
      reasons: valid ? [] : ["stored signature does not verify against the published Ed25519 key"],
    });
  }

  if (!hmacSecret) {
    return jsonResponse({
      status: "unknown", ...base, verification_method: "hmac",
      reasons: ["signing secret not configured on this host; cannot verify this V2/V3 row"],
    });
  }
  const expected = await hmacHex(hmacSecret, row.signing_payload);
  const valid = await timingSafeEqualHex(hmacSecret, row.signature, expected);
  return jsonResponse({
    status: valid ? "valid" : "invalid",
    ...base,
    verification_method: "hmac",
    // Said plainly on every legacy row rather than left for a reader to infer from the
    // version string. It lives in its own field, NOT in reasons: reasons explains a
    // non-valid outcome, and "valid with empty reasons" is a contract two existing tests
    // assert. A ledger that labels its own weaker historical guarantee is more credible
    // than one that pretends uniformity — but not at the cost of changing a shipped API.
    issuer_attested: true,
    attestation_note: "HMAC verification recomputes the signature under FreshContext's own secret. It proves the stored payload is unaltered, but only FreshContext can perform the check, so this is issuer attestation — not independent verification. Ed25519 (V4) verdicts are verifiable by anyone from the published key, with no FreshContext involvement.",
    reasons: valid ? [] : ["stored signature does not match recomputed HMAC over the stored payload"],
  });
}

const SNAPSHOT_COLUMNS =
  "signing_payload, signature, engine_version, evaluated_at, signature_version";

async function ledgerRowsByVerdictId(
  ledger: LedgerReader,
  verdictId: string,
  limit: number
): Promise<SnapshotRow[]> {
  const res = await ledger
    .prepare(
      `SELECT ${SNAPSHOT_COLUMNS} FROM evaluation_snapshots ` +
      `WHERE verdict_id = ? ORDER BY evaluated_at DESC LIMIT ?`
    )
    .bind(verdictId, limit)
    .all<SnapshotRow>();
  return res.results ?? [];
}

async function ledgerRowById(ledger: LedgerReader, id: string): Promise<SnapshotRow | null> {
  const res = await ledger
    .prepare(`SELECT ${SNAPSHOT_COLUMNS} FROM evaluation_snapshots WHERE id = ? LIMIT 1`)
    .bind(id)
    .all<SnapshotRow>();
  return res.results?.[0] ?? null;
}

// Mode 2 — ledger-backed. Reads the STORED signing_payload + signature from
// evaluation_snapshots and verifies THOSE bytes. This is what makes verification
// read the stored engine_version rather than any live constant, and what makes the
// append-only ledger the anchor of trust. verdict_id is non-unique by design
// (excludes evaluated_at), so a verdict_id lookup verifies the most recent row and
// reports matched_rows; an id lookup targets one exact row.
async function handleVerifyLedger(
  body: JsonRecord,
  hmacSecret: string | undefined,
  ledger: LedgerReader | undefined,
  resolvePublicKey?: PublicKeyResolver
): Promise<Response> {
  if (!ledger) {
    return jsonResponse({
      status: "unknown",
      reasons: ["ledger not available on this host; cannot verify by verdict_id or id"],
    });
  }

  // Mode 2b — precise lookup by row primary key.
  if (body.id !== undefined) {
    const id = body.id;
    if (typeof id !== "string" || id.trim() === "") {
      return errorResponse("invalid_request", "id must be a non-empty string.", 400);
    }
    let row: SnapshotRow | null;
    try {
      row = await ledgerRowById(ledger, id);
    } catch {
      return jsonResponse({ status: "unknown", reasons: ["ledger read failed; verification status unknown"] });
    }
    if (!row) {
      return jsonResponse({ status: "unknown", matched_rows: 0, reasons: ["no ledger row for this id"] });
    }
    return verifyRow(row, hmacSecret, { matched_rows: 1 }, resolvePublicKey);
  }

  // Mode 2a — lookup by verdict_id (non-unique → verify most recent).
  const verdictId = body.verdict_id;
  if (typeof verdictId !== "string" || !VERDICT_ID_RE.test(verdictId)) {
    return errorResponse("invalid_request", "verdict_id must be a 64-character lowercase hex string.", 400);
  }
  let rows: SnapshotRow[];
  try {
    rows = await ledgerRowsByVerdictId(ledger, verdictId, LEDGER_LOOKUP_LIMIT);
  } catch {
    return jsonResponse({ status: "unknown", verdict_id: verdictId, reasons: ["ledger read failed; verification status unknown"] });
  }
  if (rows.length === 0) {
    return jsonResponse({
      status: "unknown",
      verdict_id: verdictId,
      matched_rows: 0,
      reasons: ["no ledger row for this verdict_id"],
    });
  }
  // rows[0] is the most recent (ORDER BY evaluated_at DESC).
  return verifyRow(rows[0], hmacSecret, {
    verdict_id: verdictId,
    matched_rows: rows.length,
    matched_rows_capped: rows.length >= LEDGER_LOOKUP_LIMIT,
  }, resolvePublicKey);
}

function signatureVersionFromPayload(signingPayload: string): HaPriSignatureVersion | null {
  const firstLine = signingPayload.split(/\r?\n/, 1)[0];
  if (
    firstLine === "FRESHCONTEXT_HA_PRI_V2" ||
    firstLine === "FRESHCONTEXT_HA_PRI_V3" ||
    firstLine === HA_PRI_V4
  ) {
    return firstLine;
  }
  return null;
}

// Mode 1 — stateless. Caller presents the full payload + signature; we recompute
// and compare. No DB touched. Byte-identical to the pre-two-mode behavior.
async function handleVerifyStateless(
  body: JsonRecord,
  hmacSecret: string | undefined,
  resolvePublicKey?: PublicKeyResolver
): Promise<Response> {
  const { signing_payload, signature } = body;

  if (typeof signing_payload !== "string" || signing_payload.trim() === "") {
    return errorResponse("invalid_request", "signing_payload must be a non-empty string.", 400);
  }

  const payloadSignatureVersion = signatureVersionFromPayload(signing_payload);
  if (body.signature_version !== undefined) {
    if (typeof body.signature_version !== "string" || body.signature_version.trim() === "") {
      return errorResponse("invalid_request", "signature_version must be a non-empty string when provided.", 400);
    }
    if (payloadSignatureVersion && body.signature_version !== payloadSignatureVersion) {
      return errorResponse(
        "invalid_request",
        "signature_version does not match the signing_payload header.",
        400
      );
    }
  }

  // Unknown (not invalid): caller has no signature to present.
  // Mirrors verifyHaPriV2's three-state contract: missing/empty → unknown, not invalid.
  if (signature === undefined || signature === null) {
    return jsonResponse({
      status: "unknown",
      signature_version: payloadSignatureVersion ?? "unknown",
      reasons: ["signature missing or empty; verification status unknown"],
    });
  }

  if (typeof signature !== "string") {
    return errorResponse("invalid_request", "signature must be a string.", 400);
  }

  if (signature.trim() === "") {
    return jsonResponse({
      status: "unknown",
      signature_version: payloadSignatureVersion ?? "unknown",
      reasons: ["signature missing or empty; verification status unknown"],
    });
  }

  // V4 — Ed25519 against a published key. Never falls back to HMAC: if the key_id is
  // unknown the honest answer is "unknown", not a second attempt under a shared secret
  // that would turn an unverifiable claim into an apparently verified one.
  if (payloadSignatureVersion === HA_PRI_V4) {
    const keyId = keyIdFromV4Payload(signing_payload);
    if (!keyId) {
      return jsonResponse({
        status: "invalid",
        signature_version: HA_PRI_V4,
        verification_method: "ed25519",
        reasons: ["payload is labelled V4 but carries no usable key_id or signature_algorithm line"],
      });
    }
    const publicKey = resolvePublicKey ? await resolvePublicKey(keyId) : undefined;
    if (!publicKey) {
      return jsonResponse({
        status: "unknown",
        signature_version: HA_PRI_V4,
        key_id: keyId,
        verification_method: "ed25519",
        reasons: [`no published verification key for key_id=${keyId}`],
      });
    }
    const valid = await verifyEd25519(publicKey, signing_payload, signature);
    return jsonResponse({
      status: valid ? "valid" : "invalid",
      signature_version: HA_PRI_V4,
      key_id: keyId,
      verification_method: "ed25519",
      reasons: valid ? [] : ["Ed25519 signature does not verify against the published key"],
    });
  }

  // V2/V3 — HMAC. Only reachable with the shared secret, which only FreshContext holds.
  if (!hmacSecret) {
    return jsonResponse({
      status: "unknown",
      reasons: ["signing secret not configured on this host; cannot verify"],
    });
  }

  const expected = await hmacHex(hmacSecret, signing_payload);

  if (await timingSafeEqualHex(hmacSecret, signature, expected)) {
    return jsonResponse({
      status: "valid",
      signature_version: payloadSignatureVersion ?? "unknown",
      verification_method: "hmac",
      issuer_attested: true,
      attestation_note: "HMAC verification recomputes the signature under FreshContext's own secret. It proves the stored payload is unaltered, but only FreshContext can perform the check, so this is issuer attestation — not independent verification. Ed25519 (V4) verdicts are verifiable by anyone from the published key, with no FreshContext involvement.",
      reasons: [],
    });
  }

  return jsonResponse({
    status: "invalid",
    signature_version: payloadSignatureVersion ?? "unknown",
    verification_method: "hmac",
    issuer_attested: true,
    attestation_note: "HMAC verification recomputes the signature under FreshContext's own secret. It proves the stored payload is unaltered, but only FreshContext can perform the check, so this is issuer attestation — not independent verification. Ed25519 (V4) verdicts are verifiable by anyone from the published key, with no FreshContext involvement.",
    reasons: ["HMAC does not match recomputed signature"],
  });
}

async function handleVerify(
  request: Request,
  hmacSecret: string | undefined,
  ledger: LedgerReader | undefined,
  resolvePublicKey?: PublicKeyResolver
): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed("POST");

  // The missing-secret check used to live here and refused every request. It is now
  // version-aware and pushed down to the HMAC branches: a host with published Ed25519
  // keys but no HMAC secret can still verify V4 perfectly well, and refusing it up here
  // would make independent verification depend on a secret only we hold — the exact
  // coupling E-2 exists to remove.
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;

  const body = parsed.body;
  const wantsLedger = body.verdict_id !== undefined || body.id !== undefined;
  const hasPayload = body.signing_payload !== undefined;

  // Ambiguous: a ledger lookup key AND a full payload. Refuse rather than guess
  // which the caller meant — the two modes verify different bytes.
  if (wantsLedger && hasPayload) {
    return errorResponse(
      "invalid_request",
      "Provide either signing_payload (stateless) or verdict_id/id (ledger-backed), not both.",
      400
    );
  }

  if (wantsLedger) {
    return handleVerifyLedger(body, hmacSecret, ledger, resolvePublicKey);
  }

  return handleVerifyStateless(body, hmacSecret, resolvePublicKey);
}

// hmacSecret and ledger are injected by the Worker (env.FC_HMAC_SECRET, env.DB) when
// mounted. handler.ts never imports or holds the secret, and never imports a database
// binding type — both arrive as call-scoped parameters. Existing callers that omit them continue to
// work: without a secret, verify returns "unknown"; without a ledger, Mode 2 returns
// "unknown". Only /v1/verify and /v1/health are mounted on the Worker (see worker.ts);
// /v1/evaluate* stay routable here for library/test use but are not exposed publicly.
export async function handleRestRequest(
  request: Request,
  hmacSecret?: string,
  ledger?: LedgerReader,
  resolvePublicKey?: PublicKeyResolver
): Promise<Response> {
  const url = new URL(request.url);

  try {
    if (url.pathname === "/v1/health") return handleHealth(request);
    if (url.pathname === "/v1/evaluate") return handleEvaluate(request);
    if (url.pathname === "/v1/evaluate-batch") return handleEvaluateBatch(request);
    if (url.pathname === "/v1/verify") return handleVerify(request, hmacSecret, ledger, resolvePublicKey);

    return errorResponse("not_found", `Not found: ${url.pathname}.`, 404);
  } catch {
    return errorResponse("internal_error", "Unexpected REST host error.", 500);
  }
}
