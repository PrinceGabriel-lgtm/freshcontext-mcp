import { evaluateSignal, evaluateSignals } from "../core/index.js";
import type {
  CoreSignalEvaluationOptions,
  FreshContextSignalInput,
} from "../core/index.js";

const SERVICE_VERSION = "0.4.0";
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

// Recompute HMAC over a stored/presented payload and compare to the presented/stored
// signature. Shared by both verify modes so the compare logic exists in exactly one place.
async function verifyRow(
  row: SnapshotRow,
  hmacSecret: string,
  extra: JsonRecord
): Promise<Response> {
  const expected = await hmacHex(hmacSecret, row.signing_payload);
  const valid = row.signature === expected;
  return jsonResponse({
    status: valid ? "valid" : "invalid",
    ...extra,
    evaluated_at: row.evaluated_at,
    engine_version: row.engine_version,
    signature_version: row.signature_version,
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
  hmacSecret: string,
  ledger: LedgerReader | undefined
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
    return verifyRow(row, hmacSecret, { matched_rows: 1 });
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
  });
}

// Mode 1 — stateless. Caller presents the full payload + signature; we recompute
// and compare. No DB touched. Byte-identical to the pre-two-mode behavior.
async function handleVerifyStateless(body: JsonRecord, hmacSecret: string): Promise<Response> {
  const { signing_payload, signature } = body;

  if (typeof signing_payload !== "string" || signing_payload.trim() === "") {
    return errorResponse("invalid_request", "signing_payload must be a non-empty string.", 400);
  }

  // Unknown (not invalid): caller has no signature to present.
  // Mirrors verifyHaPriV2's three-state contract: missing/empty → unknown, not invalid.
  if (signature === undefined || signature === null) {
    return jsonResponse({
      status: "unknown",
      reasons: ["signature missing or empty; verification status unknown"],
    });
  }

  if (typeof signature !== "string") {
    return errorResponse("invalid_request", "signature must be a string.", 400);
  }

  if (signature.trim() === "") {
    return jsonResponse({
      status: "unknown",
      reasons: ["signature missing or empty; verification status unknown"],
    });
  }

  const expected = await hmacHex(hmacSecret, signing_payload);

  if (signature === expected) {
    return jsonResponse({ status: "valid", reasons: [] });
  }

  return jsonResponse({ status: "invalid", reasons: ["HMAC does not match recomputed signature"] });
}

async function handleVerify(
  request: Request,
  hmacSecret: string | undefined,
  ledger: LedgerReader | undefined
): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed("POST");

  if (!hmacSecret) {
    return jsonResponse({
      status: "unknown",
      reasons: ["signing secret not configured on this host; cannot verify"],
    });
  }

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
    return handleVerifyLedger(body, hmacSecret, ledger);
  }

  return handleVerifyStateless(body, hmacSecret);
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
  ledger?: LedgerReader
): Promise<Response> {
  const url = new URL(request.url);

  try {
    if (url.pathname === "/v1/health") return handleHealth(request);
    if (url.pathname === "/v1/evaluate") return handleEvaluate(request);
    if (url.pathname === "/v1/evaluate-batch") return handleEvaluateBatch(request);
    if (url.pathname === "/v1/verify") return handleVerify(request, hmacSecret, ledger);

    return errorResponse("not_found", `Not found: ${url.pathname}.`, 404);
  } catch {
    return errorResponse("internal_error", "Unexpected REST host error.", 500);
  }
}
