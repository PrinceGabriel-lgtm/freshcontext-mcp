/**
 * Commercial application intake — DELIBERATELY UNMOUNTED.
 *
 * This module is not referenced by worker.ts, is not in isAllowedRoute, and is gated
 * behind INTAKE_ENABLED on top of that. Deploying it changes no production behaviour;
 * being unreferenced, it is tree-shaken out of the built bundle entirely.
 *
 * It must stay that way until privacy.html accurately describes the processing. CORS is
 * a browser control, not access control: a public anonymous writer is public the moment
 * it is routable, whether or not a page links to it. Privacy notice may lead collection.
 * It must never lag it.
 *
 * Shape follows commercialHost.ts: an env interface and exported handlers, proven by
 * test before anything can reach them.
 */

export const INTAKE_PATH = "/commercial/applications";

const ALLOWED_ORIGIN = "https://freshcontext.dev";
const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/**
 * Request body cap, in BYTES.
 *
 * Named in bytes and measured in bytes. An earlier version compared String.length, which
 * counts UTF-16 code units: an astral-plane character is 2 units and 4 UTF-8 bytes, so a
 * body of emoji roughly twice this size passed the check. The limit is now applied to the
 * decoded ArrayBuffer, with Content-Length used only as an early reject.
 */
export const MAX_BODY_BYTES = 32 * 1024;

/** Cloudflare documents Turnstile tokens as at most 2048 characters. */
export const MAX_TURNSTILE_TOKEN_LENGTH = 2048;

/** Siteverify is a dependency on someone else's availability. Bound the wait. */
const SITEVERIFY_TIMEOUT_MS = 5_000;

/** Retention window for an unconverted application. See migration 0002, question (a). */
export const RETENTION_DAYS = 90;

const DEFAULT_EXPECTED_HOSTNAME = "freshcontext.dev";
const DEFAULT_EXPECTED_ACTION = "commercial_application";

/**
 * The subset of Cloudflare's rate-limiting binding this module uses.
 *
 * Declared as an interface rather than taking a dependency on the concrete binding type
 * so the behaviour is provable before the binding is wired in wrangler.jsonc. Wiring it
 * is a mounting concern and is deliberately out of scope while the route is disabled.
 */
export interface IntakeRateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface ApplicationIntakeEnv {
  DB: D1Database;
  /** Dedicated bucket. Abuse of a public form must not consume the verification budget. */
  INTAKE_RATE_LIMITER?: IntakeRateLimiter;
  TURNSTILE_SECRET?: string;
  TURNSTILE_EXPECTED_HOSTNAME?: string;
  TURNSTILE_EXPECTED_ACTION?: string;
  /** Strictly "true" enables the intake. Anything else, including absent, disables it. */
  INTAKE_ENABLED?: string;
}

/**
 * Canonical operational vocabulary. ops/commercial/README.md is the source of truth for
 * everything except INVOICE_ISSUED, which is added because the existing machinery cannot
 * otherwise prove issuance: generate-pack.mjs mints FC-INV-... into a manifest whose only
 * status is DRAFT_NOT_EXECUTED, and DEPOSIT_PENDING implies an invoice exists without
 * evidencing that it was formally issued.
 */
export const OPERATIONAL_STATES = [
  "APPLICATION_RECEIVED",
  "QUALIFIED",
  "SCOPE_APPROVED",
  "CONTRACT_SENT",
  "SIGNED",
  "INVOICE_ISSUED",
  "DEPOSIT_PENDING",
  "DEPOSIT_CLEARED",
  "READY_TO_START",
  "IN_PROGRESS",
  "ACCEPTANCE_PENDING",
  "ACCEPTED",
  "FINAL_PAYMENT_DUE",
  "CLOSED",
  "DECLINED",
  "CLARIFICATION_REQUIRED",
  "PAUSED",
  "CANCELLED",
  "DISPUTED",
] as const;

export type OperationalState = (typeof OPERATIONAL_STATES)[number];

/**
 * Funnel stage is a PROJECTION of operational state, derived on read and never stored.
 *
 * Same reasoning as verification_status in migration 0001: a value derivable from data
 * already in the row is computed, not persisted, because a stored copy can disagree with
 * its source and the disagreement is silent.
 *
 * The projection is lossy on purpose. SCOPE_APPROVED and CONTRACT_SENT are one funnel
 * stage and two different operational facts; the funnel is for counting, the state is for
 * operating. Anything that cannot honestly be placed on the path to cash reports
 * out_of_funnel rather than being forced into a stage it does not belong to.
 */
const FUNNEL_STAGES: Record<string, string> = {
  APPLICATION_RECEIVED: "received",
  QUALIFIED: "qualified",
  SCOPE_APPROVED: "service_order",
  CONTRACT_SENT: "service_order",
  SIGNED: "signed",
  INVOICE_ISSUED: "invoiced",
  DEPOSIT_PENDING: "invoiced",
  DEPOSIT_CLEARED: "paid",
  READY_TO_START: "delivery",
  IN_PROGRESS: "delivery",
  ACCEPTANCE_PENDING: "delivery",
  ACCEPTED: "accepted",
  FINAL_PAYMENT_DUE: "accepted",
  CLOSED: "closed",
  DECLINED: "declined",
  CLARIFICATION_REQUIRED: "out_of_funnel",
  PAUSED: "out_of_funnel",
  CANCELLED: "out_of_funnel",
  DISPUTED: "out_of_funnel",
};

/** Returns "unknown" rather than guessing — an unrecognised state must not silently count. */
export function funnelStageFor(status: string): string {
  return FUNNEL_STAGES[status] ?? "unknown";
}

export function isIntakeEnabled(env: { INTAKE_ENABLED?: string }): boolean {
  return env.INTAKE_ENABLED === "true";
}

// ─── field contract ───────────────────────────────────────────────────────────
//
// Mirrors the live /apply form. Caps match the page's maxlength attributes, which are
// advisory on the client and enforced here. Select allowlists are the page's own option
// values: a value outside them did not come from the form.

const SERVICES = ["assessment", "single-workflow", "private-multi", "build-to-spec"];

const TEXT_FIELDS: Record<string, number> = {
  company: 160,
  name: 120,
  email: 254,
  role: 120,
  workflow: 900,
  stack: 700,
  failure: 900,
  acceptance: 700,
};

const SELECT_FIELDS: Record<string, string[]> = {
  service: SERVICES,
  timeline: [
    "Within 2 weeks",
    "Within 30 days",
    "Within 60 days",
    "Quarter / later",
    "Exploratory — no fixed date",
  ],
  environment: [
    "Local / developer environment",
    "Staging / test",
    "Production",
    "Private / customer-managed environment",
    "Not yet decided",
  ],
  sensitivity: [
    "Public / non-sensitive test data",
    "Internal business data",
    "Customer or personal data may be involved",
    "Regulated / high-sensitivity environment",
    "Not sure yet",
  ],
  authority: [
    "I can approve this engagement",
    "I can recommend it but need approval",
    "I am evaluating on behalf of someone else",
    "Exploratory only",
  ],
};

const CLIENT_REFERENCE_PATTERN = /^FC-APP-\d{8}-[0-9A-F]{6}$/;

/**
 * Deliberately modest email validation.
 *
 * The goal is to catch an address that obviously cannot receive mail, not to adjudicate
 * RFC 5322 — which permits quoted local parts, comments and address literals that no
 * commercial applicant will ever type, and which regex cannot express correctly anyway.
 * A local part, an @, a domain with at least one dot, and no whitespace. Anything that
 * passes this and still bounces is discovered when the reply bounces.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

// ─── responses ────────────────────────────────────────────────────────────────
//
// Rejection bodies carry a reason code and never a field value. An error that echoes
// input is an error that leaks it into logs, screenshots and bug reports.

function corsHeaders(): Record<string, string> {
  return {
    "access-control-allow-origin": ALLOWED_ORIGIN,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

function refuse(status: number, reason: string): Response {
  return new Response(JSON.stringify({ error: reason }), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders() },
  });
}

// ─── bounded body read ────────────────────────────────────────────────────────

type BoundedRead =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; reason: "too_large" | "read_failed" };

/**
 * Reads the request body while bounding it, rather than buffering it and judging after.
 *
 * request.arrayBuffer() materialises the entire body first, so with no Content-Length —
 * or a dishonest one — an anonymous caller could make the Worker hold an arbitrarily
 * large body in memory and only then be told it was too big. The limit has to bound the
 * read itself.
 *
 * Accumulates at most maxBytes, cancels the stream the moment that is exceeded, and never
 * concatenates an over-limit body.
 */
async function readBoundedBody(request: Request, maxBytes: number): Promise<BoundedRead> {
  const body = request.body;
  if (!body) return { ok: true, bytes: new Uint8Array(0) };

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;

      total += value.byteLength;
      if (total > maxBytes) {
        // Stop pulling immediately. The sender may still be writing; we are done.
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: "too_large" };
      }
      chunks.push(value);
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    return { ok: false, reason: "read_failed" };
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

// ─── reference minting ────────────────────────────────────────────────────────

/** FC-APP-YYYYMMDD-XXXXXX, matching the format the page already mints and tests assert. */
function mintReference(now: Date): string {
  const compact =
    String(now.getUTCFullYear()) +
    String(now.getUTCMonth() + 1).padStart(2, "0") +
    String(now.getUTCDate()).padStart(2, "0");
  const bytes = crypto.getRandomValues(new Uint8Array(3));
  const suffix = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
  return `FC-APP-${compact}-${suffix}`;
}

// ─── turnstile ────────────────────────────────────────────────────────────────

interface SiteverifyOutcome {
  success?: boolean;
  hostname?: string;
  action?: string;
}

/**
 * Verifies a Turnstile token and checks that it was minted for THIS site and THIS widget.
 *
 * success === true alone is not sufficient: it says the token is a valid Turnstile token,
 * not that it came from the form being protected. Without the hostname and action checks,
 * a token harvested from any other Turnstile widget the same account operates would be
 * accepted here.
 *
 * Fails closed on every uncertain path — timeout, network error, non-2xx, unparseable
 * body, mismatch. Nothing about the outcome is logged or persisted.
 */
async function verifyTurnstile(
  token: string,
  secret: string,
  expectedHostname: string,
  expectedAction: string,
): Promise<boolean> {
  const body = new URLSearchParams({ secret, response: token });
  // remoteip is optional and is deliberately not sent: it is not required for
  // verification and sending it would hand the IP to a third party for no benefit.
  try {
    const res = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS),
    });
    if (!res.ok) return false;
    const outcome = (await res.json()) as SiteverifyOutcome;
    if (outcome.success !== true) return false;
    if (outcome.hostname !== expectedHostname) return false;
    if (outcome.action !== expectedAction) return false;
    return true;
  } catch {
    // Timeout, abort, network failure or malformed JSON. An intake that cannot verify
    // must not write: the alternative is an unprotected anonymous writer the moment
    // Cloudflare has a bad minute.
    return false;
  }
}

// ─── handler ──────────────────────────────────────────────────────────────────

export async function handleApplicationIntake(
  request: Request,
  env: ApplicationIntakeEnv,
): Promise<Response> {
  // 1. Feature gate. A disabled intake is indistinguishable from a route that does not
  //    exist — it does not advertise that it is merely switched off.
  if (!isIntakeEnabled(env)) {
    return new Response("Not Found", { status: 404 });
  }

  // 2. Preflight.
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  // 3. Method.
  if (request.method !== "POST") {
    return refuse(405, "method_not_allowed");
  }

  // 4. Origin. Checked before anything is read, and never answered with a wildcard.
  if (request.headers.get("origin") !== ALLOWED_ORIGIN) {
    return refuse(403, "origin_not_allowed");
  }

  // 5. Content type. The contract is JSON; a form post or text/plain is not it. Declared
  //    parameters such as charset are permitted, the bare type is not negotiable.
  const contentType = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    return refuse(415, "unsupported_media_type");
  }

  // 6. Declared size, as an EARLY reject only. The header is attacker-controlled, so it
  //    can refuse work but can never be the sole control — the real check is step 8.
  const declaredLength = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return refuse(413, "payload_too_large");
  }

  // 7. Rate limit, BEFORE the Siteverify subrequest. Otherwise an attacker who will
  //    ultimately fail the challenge can still drive unbounded verification traffic
  //    against Cloudflare at our expense. The key is derived from the connecting IP and
  //    used transiently: it is never written to D1 and never logged.
  if (!env.INTAKE_RATE_LIMITER) {
    // Misconfiguration must fail closed. An unrated public writer is the thing this
    // control exists to prevent.
    return refuse(503, "rate_limit_unavailable");
  }

  // No client IP means no rate-limit identity. Bucketing those callers together under a
  // placeholder key would give them one shared global quota, which an attacker can
  // exhaust to deny service to every other caller in it — a rate limit that creates the
  // outage it exists to prevent. Refuse instead.
  const clientIp = request.headers.get("cf-connecting-ip");
  if (!clientIp) {
    return refuse(503, "rate_limit_unavailable");
  }

  let withinLimit: boolean;
  try {
    // The IP is used only to derive this key. It is never written to D1 and never logged.
    const outcome = await env.INTAKE_RATE_LIMITER.limit({ key: `intake:${clientIp}` });
    withinLimit = outcome.success;
  } catch {
    // limit() is a platform dependency and can reject. An unhandled rejection would
    // escape the handler; worse, swallowing it and continuing would leave an
    // unprotected write path exactly when the protection is unavailable.
    return refuse(503, "rate_limit_unavailable");
  }
  if (!withinLimit) {
    return refuse(429, "rate_limited");
  }

  // 8. Actual size, enforced DURING the read rather than after it. Step 6 was only an
  //    optimisation against an honest Content-Length.
  const read = await readBoundedBody(request, MAX_BODY_BYTES);
  if (!read.ok) {
    return read.reason === "too_large"
      ? refuse(413, "payload_too_large")
      : refuse(400, "malformed_request_body");
  }
  const raw = new TextDecoder().decode(read.bytes);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return refuse(400, "malformed_json");
  }

  // 9. Document shape. JSON.parse succeeds for null, arrays, strings, numbers and
  //    booleans, none of which are the documented object contract. Reading a field off
  //    null throws; reading one off an array silently yields undefined. Require the
  //    shape explicitly rather than discovering it downstream.
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return refuse(400, "expected_json_object");
  }
  const payload = parsed as Record<string, unknown>;

  // 10. Turnstile. Token bounds are checked locally so an oversized or absent token
  //     costs no outbound request.
  const token = typeof payload.turnstile_token === "string" ? payload.turnstile_token : "";
  if (!token || token.length > MAX_TURNSTILE_TOKEN_LENGTH) {
    return refuse(403, "challenge_required");
  }
  if (!env.TURNSTILE_SECRET) {
    return refuse(403, "challenge_unavailable");
  }
  const verified = await verifyTurnstile(
    token,
    env.TURNSTILE_SECRET,
    env.TURNSTILE_EXPECTED_HOSTNAME ?? DEFAULT_EXPECTED_HOSTNAME,
    env.TURNSTILE_EXPECTED_ACTION ?? DEFAULT_EXPECTED_ACTION,
  );
  if (!verified) {
    return refuse(403, "challenge_failed");
  }

  // 11. Validation.
  for (const [field, max] of Object.entries(TEXT_FIELDS)) {
    const value = payload[field];
    if (typeof value !== "string" || value.trim() === "") {
      return refuse(400, "missing_field");
    }
    if (value.length > max) {
      return refuse(400, "field_too_long");
    }
  }
  if (!EMAIL_PATTERN.test(payload.email as string)) {
    return refuse(400, "email_not_valid");
  }
  for (const [field, allowed] of Object.entries(SELECT_FIELDS)) {
    const value = payload[field];
    if (typeof value !== "string" || value === "") {
      return refuse(400, "missing_field");
    }
    if (!allowed.includes(value)) {
      return refuse(400, "value_not_permitted");
    }
  }
  if (payload.acknowledgement !== true) {
    return refuse(400, "acknowledgement_required");
  }

  // 12. The client's reference is kept for correspondence matching only, and only if it
  //     is the shape the page produces. Anything else is discarded rather than stored.
  const claimed = payload.client_reference;
  const clientReference =
    typeof claimed === "string" && CLIENT_REFERENCE_PATTERN.test(claimed) ? claimed : null;

  // 13. Mint, and write. Note what is absent: no IP, no user agent, no header value, and
  //     nothing from the Siteverify response.
  const now = new Date();
  const receivedAt = now.toISOString();
  const purgeAfter = new Date(now.getTime() + RETENTION_DAYS * 86_400_000).toISOString();

  const insert = `INSERT INTO commercial_applications
    (reference, client_reference, service, company, contact_name, contact_email,
     contact_role, workflow, stack, failure_mode, acceptance, timeline, environment,
     sensitivity, authority, acknowledged, status, received_at, purge_after)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'APPLICATION_RECEIVED', ?, ?)`;

  // A minted collision is astronomically unlikely but is a PK violation, not a silent
  // overwrite. Retry a bounded number of times rather than returning someone else's row.
  for (let attempt = 0; attempt < 3; attempt++) {
    const reference = mintReference(now);
    try {
      await env.DB.prepare(insert)
        .bind(
          reference,
          clientReference,
          payload.service as string,
          payload.company as string,
          payload.name as string,
          payload.email as string,
          payload.role as string,
          payload.workflow as string,
          payload.stack as string,
          payload.failure as string,
          payload.acceptance as string,
          payload.timeline as string,
          payload.environment as string,
          payload.sensitivity as string,
          payload.authority as string,
          receivedAt,
          purgeAfter,
        )
        .run();

      return new Response(JSON.stringify({ reference, received_at: receivedAt }), {
        status: 201,
        headers: { "content-type": "application/json", ...corsHeaders() },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!/UNIQUE|PRIMARY KEY/i.test(message)) {
        // Never surface the driver's message: it can quote bound parameters, which are
        // the applicant's own answers.
        return refuse(500, "intake_unavailable");
      }
    }
  }
  return refuse(500, "intake_unavailable");
}

// ─── retention ────────────────────────────────────────────────────────────────

/**
 * Deletes unconverted applications whose stated window has elapsed.
 *
 * Rows with a NULL purge_after are live matters, cleared by explicit operator transition,
 * and are never touched here. Returns the number deleted so the scheduled handler can log
 * a count without logging any row.
 *
 * This is what makes the 90-day window a control rather than an intention. Until this
 * runs on the 6-hourly schedule, the privacy notice may not claim automated deletion.
 */
export async function purgeExpiredApplications(
  env: Pick<ApplicationIntakeEnv, "DB">,
  nowIso: string = new Date().toISOString(),
): Promise<number> {
  const result = await env.DB.prepare(
    `DELETE FROM commercial_applications
      WHERE purge_after IS NOT NULL AND purge_after <= ?`,
  )
    .bind(nowIso)
    .run();
  return result.meta?.changes ?? 0;
}
