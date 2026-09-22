import { env, fetchMock } from "cloudflare:test";
import { describe, test, expect, beforeAll, beforeEach, afterEach } from "vitest";
import {
  INTAKE_PATH,
  MAX_BODY_BYTES,
  MAX_TURNSTILE_TOKEN_LENGTH,
  isIntakeEnabled,
  handleApplicationIntake,
  purgeExpiredApplications,
  funnelStageFor,
  OPERATIONAL_STATES,
  type ApplicationIntakeEnv,
  type IntakeRateLimiter,
} from "../src/applicationIntake.js";

// ─── Unit/integration harness for the UNMOUNTED intake module ─────────────────
//
// The route is deliberately not in worker.ts and not in isAllowedRoute. These tests
// drive handleApplicationIntake directly, which is the shape commercialHost.ts is
// tested in: the module is proven before it is ever reachable.
//
// A mounted-route integration test belongs in the release that mounts it, and must not
// be written now — it would pass against a route that does not exist.

// The REAL migration, injected as a binding by vitest.config.mts. Nothing here restates
// the schema: these tests run the same SQL D1 will run, so test/production drift is
// impossible by construction rather than by assertion.
const MIGRATION_SQL = env.MIGRATION_0002_SQL as string;

/** Executes a migration artifact statement-by-statement, comments stripped. */
async function applyMigration(db: D1Database, sql: string): Promise<number> {
  const stripped = sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
  const statements = stripped
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const statement of statements) {
    await db.prepare(statement).run();
  }
  return statements.length;
}

const TURNSTILE_SECRET = "miniflare-turnstile-secret-not-prod";
const SITEVERIFY = "https://challenges.cloudflare.com";
const ORIGIN = "https://freshcontext.dev";
const EXPECTED_HOSTNAME = "freshcontext.dev";
const EXPECTED_ACTION = "commercial_application";

/** Allows everything. Rate-limit refusal is tested with denyingLimiter below. */
function allowingLimiter(): IntakeRateLimiter & { keys: string[] } {
  const keys: string[] = [];
  return { keys, limit: async ({ key }) => (keys.push(key), { success: true }) };
}

function denyingLimiter(): IntakeRateLimiter {
  return { limit: async () => ({ success: false }) };
}

function intakeEnv(overrides: Partial<ApplicationIntakeEnv> = {}): ApplicationIntakeEnv {
  return {
    DB: env.DB as D1Database,
    TURNSTILE_SECRET,
    INTAKE_ENABLED: "true",
    INTAKE_RATE_LIMITER: allowingLimiter(),
    TURNSTILE_EXPECTED_HOSTNAME: EXPECTED_HOSTNAME,
    TURNSTILE_EXPECTED_ACTION: EXPECTED_ACTION,
    ...overrides,
  };
}

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    service: "assessment",
    company: "Example Systems (Pty) Ltd",
    name: "Alex Buyer",
    email: "alex@example.com",
    role: "Head of Platform",
    workflow: "Customer support RAG answering billing questions from a help centre.",
    stack: "Postgres + pgvector, LangChain, GPT-4o.",
    failure: "Answers cite a pricing page that changed two months ago.",
    acceptance: "Stale pricing context is excluded or flagged before handoff.",
    timeline: "Within 30 days",
    environment: "Staging / test",
    sensitivity: "Internal business data",
    authority: "I can approve this engagement",
    acknowledgement: true,
    client_reference: "FC-APP-20260922-A1B2C3",
    turnstile_token: "test-token",
    ...overrides,
  };
}

function post(body: unknown, init: { headers?: Record<string, string> } = {}) {
  return new Request(`https://api.freshcontext.dev${INTAKE_PATH}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: ORIGIN,
      // Present on the request and expected NEVER to reach D1.
      "cf-connecting-ip": "203.0.113.7",
      "user-agent": "Mozilla/5.0 (test-agent)",
      ...init.headers,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function mockTurnstile(
  outcome: { success: boolean; hostname?: string; action?: string } = { success: true },
) {
  fetchMock
    .get(SITEVERIFY)
    .intercept({ path: /siteverify/, method: "POST" })
    .reply(200, {
      success: outcome.success,
      hostname: outcome.hostname ?? EXPECTED_HOSTNAME,
      action: outcome.action ?? EXPECTED_ACTION,
      "error-codes": outcome.success ? [] : ["invalid-input-response"],
    });
}

async function rowCount(): Promise<number> {
  const r = await (env.DB as D1Database)
    .prepare("SELECT COUNT(*) AS n FROM commercial_applications")
    .first<{ n: number }>();
  return r?.n ?? 0;
}

beforeAll(async () => {
  const applied = await applyMigration(env.DB as D1Database, MIGRATION_SQL);
  expect(applied, "migration artifact produced no statements").toBeGreaterThan(0);
});

beforeEach(async () => {
  await (env.DB as D1Database).exec("DELETE FROM commercial_applications");
  fetchMock.activate();
  fetchMock.disableNetConnect();
});

afterEach(() => {
  fetchMock.assertNoPendingInterceptors();
});

// ─── the migration artifact itself ────────────────────────────────────────────

describe("migration artifact", () => {
  test("the tests run the real migration, not a copy of it", () => {
    expect(MIGRATION_SQL).toContain("CREATE TABLE IF NOT EXISTS commercial_applications");
    expect(MIGRATION_SQL).toContain("purge_after");
  });

  test("every column the handler writes exists in the real schema", async () => {
    const info = await (env.DB as D1Database)
      .prepare("PRAGMA table_info(commercial_applications)")
      .all<{ name: string }>();
    const columns = new Set(info.results.map((r) => r.name));
    for (const required of [
      "reference", "client_reference", "service", "company", "contact_name",
      "contact_email", "contact_role", "workflow", "stack", "failure_mode",
      "acceptance", "timeline", "environment", "sensitivity", "authority",
      "acknowledged", "status", "received_at", "purge_after",
    ]) {
      expect(columns, `migration is missing ${required}`).toContain(required);
    }
  });

  test("the schema persists no network metadata column", async () => {
    const info = await (env.DB as D1Database)
      .prepare("PRAGMA table_info(commercial_applications)")
      .all<{ name: string }>();
    const columns = info.results.map((r) => r.name.toLowerCase());
    for (const forbidden of ["ip", "ip_address", "user_agent", "useragent", "remote_addr"]) {
      expect(columns).not.toContain(forbidden);
    }
  });
});

// ─── feature gate ─────────────────────────────────────────────────────────────

describe("feature gate", () => {
  test("intake is disabled unless explicitly enabled", () => {
    expect(isIntakeEnabled({})).toBe(false);
    expect(isIntakeEnabled({ INTAKE_ENABLED: "false" })).toBe(false);
    expect(isIntakeEnabled({ INTAKE_ENABLED: "1" })).toBe(false);
    expect(isIntakeEnabled({ INTAKE_ENABLED: "true" })).toBe(true);
  });

  test("a disabled intake writes nothing and does not advertise itself", async () => {
    const res = await handleApplicationIntake(post(validBody()), intakeEnv({ INTAKE_ENABLED: undefined }));
    expect(res.status).toBe(404);
    expect(await rowCount()).toBe(0);
  });
});

// ─── method, origin, content type, payload guards ─────────────────────────────

describe("request guards", () => {
  test("OPTIONS returns the preflight with the exact origin, never a wildcard", async () => {
    const res = await handleApplicationIntake(
      new Request(`https://api.freshcontext.dev${INTAKE_PATH}`, { method: "OPTIONS", headers: { origin: ORIGIN } }),
      intakeEnv(),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(res.headers.get("access-control-allow-origin")).not.toBe("*");
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
  });

  test("a disallowed origin is refused and writes nothing", async () => {
    const res = await handleApplicationIntake(
      post(validBody(), { headers: { origin: "https://evil.example" } }),
      intakeEnv(),
    );
    expect(res.status).toBe(403);
    expect(await rowCount()).toBe(0);
  });

  test("non-POST methods return 405", async () => {
    const res = await handleApplicationIntake(
      new Request(`https://api.freshcontext.dev${INTAKE_PATH}`, { method: "GET", headers: { origin: ORIGIN } }),
      intakeEnv(),
    );
    expect(res.status).toBe(405);
  });

  // REGRESSION: the handler previously parsed JSON regardless of declared type.
  test.each(["text/plain", "application/x-www-form-urlencoded", "multipart/form-data", ""])(
    "content-type %s is refused with 415 and writes nothing",
    async (ct) => {
      const res = await handleApplicationIntake(
        post(validBody(), { headers: { "content-type": ct } }),
        intakeEnv(),
      );
      expect(res.status).toBe(415);
      expect(await rowCount()).toBe(0);
    },
  );

  test("application/json with a charset parameter is accepted", async () => {
    mockTurnstile();
    const res = await handleApplicationIntake(
      post(validBody(), { headers: { "content-type": "application/json; charset=utf-8" } }),
      intakeEnv(),
    );
    expect(res.status).toBe(201);
  });

  test("an oversize ASCII body is rejected and writes nothing", async () => {
    const huge = JSON.stringify(validBody({ workflow: "x".repeat(40_000) }));
    const res = await handleApplicationIntake(post(huge), intakeEnv());
    expect(res.status).toBe(413);
    expect(await rowCount()).toBe(0);
  });

  // REGRESSION: raw.length counts UTF-16 code units, not UTF-8 bytes. A body of
  // astral-plane characters is 2 code units and 4 bytes each, so character counting
  // let a body roughly twice the byte limit through.
  test("a body under the character count but over the byte limit is still rejected", async () => {
    const emoji = "\u{1F600}".repeat(9000); // 18,000 UTF-16 units, 36,000 UTF-8 bytes
    const body = JSON.stringify(validBody({ workflow: emoji }));
    expect(body.length).toBeLessThan(MAX_BODY_BYTES);
    expect(new TextEncoder().encode(body).length).toBeGreaterThan(MAX_BODY_BYTES);
    const res = await handleApplicationIntake(post(body), intakeEnv());
    expect(res.status).toBe(413);
    expect(await rowCount()).toBe(0);
  });

  test("an oversize declared Content-Length is refused before the body is read", async () => {
    const res = await handleApplicationIntake(
      post(validBody(), { headers: { "content-length": String(MAX_BODY_BYTES + 1) } }),
      intakeEnv(),
    );
    expect(res.status).toBe(413);
    expect(await rowCount()).toBe(0);
  });

  // REGRESSION: request.arrayBuffer() buffers the WHOLE body before the size can be
  // checked. With no Content-Length, or a dishonest one, an anonymous caller could make
  // the Worker materialise an arbitrarily large body first and be refused afterwards.
  // The limit has to bound the read, not just judge it.
  test("an oversized streamed body with no Content-Length is refused without being fully read", async () => {
    const CHUNK_BYTES = 1024;
    const TOTAL_CHUNKS = 400; // 400 KiB if fully drained — far past the 32 KiB cap
    let pulls = 0;

    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls > TOTAL_CHUNKS) {
          controller.close();
          return;
        }
        controller.enqueue(new Uint8Array(CHUNK_BYTES).fill(0x78)); // 'x'
      },
    });

    const request = new Request(`https://api.freshcontext.dev${INTAKE_PATH}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: ORIGIN,
        "cf-connecting-ip": "203.0.113.7",
      },
      body,
      // Required by the Fetch spec for a stream body; not in the stock RequestInit type.
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    expect(request.headers.get("content-length")).toBeNull();

    const res = await handleApplicationIntake(request, intakeEnv());
    expect(res.status).toBe(413);
    expect(await rowCount()).toBe(0);

    // The cap is 32 KiB of 1 KiB chunks, so the reader should stop around 33 pulls.
    // Anything approaching TOTAL_CHUNKS means the body was drained before judging it.
    expect(pulls).toBeLessThan(TOTAL_CHUNKS / 2);
    expect(pulls).toBeLessThanOrEqual(MAX_BODY_BYTES / CHUNK_BYTES + 5);
  });
});

// ─── JSON shape ───────────────────────────────────────────────────────────────

describe("JSON document shape", () => {
  // REGRESSION: JSON.parse("null") succeeds and the handler then dereferenced null.
  test.each([
    ["null", "null"],
    ["an array", "[]"],
    ["a populated array", '[{"service":"assessment"}]'],
    ["a JSON string", '"just a string"'],
    ["a JSON number", "42"],
    ["a JSON boolean", "true"],
  ])("%s is a controlled 400, never an exception", async (_label, raw) => {
    const res = await handleApplicationIntake(post(raw), intakeEnv());
    expect(res.status).toBe(400);
    expect(await rowCount()).toBe(0);
  });

  test("malformed JSON is a controlled 400", async () => {
    const res = await handleApplicationIntake(post("{not json"), intakeEnv());
    expect(res.status).toBe(400);
    expect(await rowCount()).toBe(0);
  });
});

// ─── rate limiting ────────────────────────────────────────────────────────────

describe("rate limiting", () => {
  // REGRESSION: there was no limiter at all, so Siteverify traffic was unbounded.
  test("a rate-limited caller gets 429 and writes nothing", async () => {
    const res = await handleApplicationIntake(
      post(validBody()),
      intakeEnv({ INTAKE_RATE_LIMITER: denyingLimiter() }),
    );
    expect(res.status).toBe(429);
    expect(await rowCount()).toBe(0);
  });

  test("the limiter runs BEFORE Turnstile, so abuse cannot drive verification traffic", async () => {
    // No Siteverify interceptor is registered. afterEach asserts none is pending and
    // net connect is disabled, so any outbound call here would fail the test.
    const res = await handleApplicationIntake(
      post(validBody()),
      intakeEnv({ INTAKE_RATE_LIMITER: denyingLimiter() }),
    );
    expect(res.status).toBe(429);
  });

  test("the limiter key is derived from the connecting IP but never persisted", async () => {
    mockTurnstile();
    const limiter = allowingLimiter();
    await handleApplicationIntake(post(validBody()), intakeEnv({ INTAKE_RATE_LIMITER: limiter }));
    expect(limiter.keys.length).toBe(1);
    expect(limiter.keys[0]).toContain("203.0.113.7");

    const row = await (env.DB as D1Database)
      .prepare("SELECT * FROM commercial_applications")
      .first<Record<string, unknown>>();
    expect(JSON.stringify(row)).not.toContain("203.0.113.7");
  });

  test("a missing limiter binding fails closed", async () => {
    const res = await handleApplicationIntake(
      post(validBody()),
      intakeEnv({ INTAKE_RATE_LIMITER: undefined }),
    );
    expect(res.status).toBe(503);
    expect(await rowCount()).toBe(0);
  });

  // REGRESSION: limit() is a platform dependency and can reject. An unhandled rejection
  // propagates out of the handler as a 500 at best, and at worst is caught nowhere and
  // becomes an unprotected write path.
  test("a limiter that throws fails closed with 503 and never reaches Turnstile", async () => {
    const throwing: IntakeRateLimiter = {
      limit: async () => {
        throw new Error("rate limiter unavailable");
      },
    };
    // No Siteverify interceptor registered; net connect is disabled. An outbound call
    // here would fail the test.
    const res = await handleApplicationIntake(
      post(validBody()),
      intakeEnv({ INTAKE_RATE_LIMITER: throwing }),
    );
    expect(res.status).toBe(503);
    expect(await rowCount()).toBe(0);
  });

  // REGRESSION: a missing CF-Connecting-IP collapsed every such caller into one shared
  // "unknown" bucket, which is a single global quota an attacker can exhaust to deny
  // service to everyone else in it. No rate-limit identity means no rate limit.
  test("a missing Cloudflare client IP is an unavailable identity, not a shared bucket", async () => {
    const request = new Request(`https://api.freshcontext.dev${INTAKE_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify(validBody()),
    });
    expect(request.headers.get("cf-connecting-ip")).toBeNull();

    const limiter = allowingLimiter();
    const res = await handleApplicationIntake(request, intakeEnv({ INTAKE_RATE_LIMITER: limiter }));
    expect(res.status).toBe(503);
    expect(limiter.keys).toEqual([]); // never consulted with a placeholder identity
    expect(await rowCount()).toBe(0);
  });
});

// ─── turnstile ────────────────────────────────────────────────────────────────

describe("turnstile", () => {
  test("a missing token is refused and writes nothing", async () => {
    const res = await handleApplicationIntake(post(validBody({ turnstile_token: undefined })), intakeEnv());
    expect(res.status).toBe(403);
    expect(await rowCount()).toBe(0);
  });

  // REGRESSION: an unbounded token was forwarded to Cloudflare verbatim.
  test("an over-long token is refused locally, without a Siteverify call", async () => {
    const res = await handleApplicationIntake(
      post(validBody({ turnstile_token: "t".repeat(MAX_TURNSTILE_TOKEN_LENGTH + 1) })),
      intakeEnv(),
    );
    expect(res.status).toBe(403);
    expect(await rowCount()).toBe(0);
  });

  test("a failed verification is refused and writes nothing", async () => {
    mockTurnstile({ success: false });
    const res = await handleApplicationIntake(post(validBody()), intakeEnv());
    expect(res.status).toBe(403);
    expect(await rowCount()).toBe(0);
  });

  // REGRESSION: success === true was sufficient; a token minted for another host or
  // another widget action was accepted.
  test("a hostname mismatch is refused even when success is true", async () => {
    mockTurnstile({ success: true, hostname: "attacker.example" });
    const res = await handleApplicationIntake(post(validBody()), intakeEnv());
    expect(res.status).toBe(403);
    expect(await rowCount()).toBe(0);
  });

  test("an action mismatch is refused even when success is true", async () => {
    mockTurnstile({ success: true, action: "newsletter_signup" });
    const res = await handleApplicationIntake(post(validBody()), intakeEnv());
    expect(res.status).toBe(403);
    expect(await rowCount()).toBe(0);
  });

  test("a missing secret fails closed", async () => {
    const res = await handleApplicationIntake(
      post(validBody()),
      intakeEnv({ TURNSTILE_SECRET: undefined }),
    );
    expect(res.status).toBe(403);
    expect(await rowCount()).toBe(0);
  });

  test("no Siteverify response metadata reaches the row", async () => {
    mockTurnstile();
    await handleApplicationIntake(post(validBody()), intakeEnv());
    const row = await (env.DB as D1Database)
      .prepare("SELECT * FROM commercial_applications")
      .first<Record<string, unknown>>();
    const serialised = JSON.stringify(row);
    expect(serialised).not.toContain(EXPECTED_ACTION);
    expect(serialised).not.toContain("challenges.cloudflare.com");
  });
});

// ─── validation ───────────────────────────────────────────────────────────────

describe("validation", () => {
  test.each([
    "service", "company", "name", "email", "role",
    "workflow", "stack", "failure", "acceptance",
    "timeline", "environment", "sensitivity", "authority",
  ])("a missing %s returns 400 and writes nothing", async (field) => {
    mockTurnstile();
    const res = await handleApplicationIntake(post(validBody({ [field]: undefined })), intakeEnv());
    expect(res.status).toBe(400);
    expect(await rowCount()).toBe(0);
  });

  test("acknowledgement must be strictly true", async () => {
    mockTurnstile();
    const res = await handleApplicationIntake(post(validBody({ acknowledgement: false })), intakeEnv());
    expect(res.status).toBe(400);
    expect(await rowCount()).toBe(0);
  });

  test("a service outside the catalog is refused", async () => {
    mockTurnstile();
    const res = await handleApplicationIntake(post(validBody({ service: "free-consulting" })), intakeEnv());
    expect(res.status).toBe(400);
    expect(await rowCount()).toBe(0);
  });

  test("a select value outside its option list is refused", async () => {
    mockTurnstile();
    const res = await handleApplicationIntake(post(validBody({ timeline: "yesterday" })), intakeEnv());
    expect(res.status).toBe(400);
    expect(await rowCount()).toBe(0);
  });

  test("an over-length field is refused", async () => {
    mockTurnstile();
    const res = await handleApplicationIntake(post(validBody({ company: "x".repeat(500) })), intakeEnv());
    expect(res.status).toBe(400);
    expect(await rowCount()).toBe(0);
  });

  // REGRESSION: the blueprint promised email shape validation; the code checked only
  // non-empty and length.
  test.each([
    "not-an-email",
    "missing-at.example.com",
    "no-domain@",
    "@no-local.example",
    "spaces in@example.com",
    "two@@example.com",
    "trailing@dot.",
  ])("an obviously malformed email (%s) is refused", async (email) => {
    mockTurnstile();
    const res = await handleApplicationIntake(post(validBody({ email })), intakeEnv());
    expect(res.status).toBe(400);
    expect(await rowCount()).toBe(0);
  });

  test.each([
    "alex@example.com",
    "alex.buyer+tag@sub.example.co.za",
    "a@b.io",
  ])("a reasonable email (%s) is accepted", async (email) => {
    mockTurnstile();
    const res = await handleApplicationIntake(post(validBody({ email })), intakeEnv());
    expect(res.status).toBe(201);
  });

  test("a rejection body never echoes field contents", async () => {
    mockTurnstile();
    const secret = "SUPER-SECRET-INTERNAL-SYSTEM-NAME";
    const res = await handleApplicationIntake(
      post(validBody({ company: secret, service: "not-a-service" })),
      intakeEnv(),
    );
    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain(secret);
  });
});

// ─── the happy path ───────────────────────────────────────────────────────────

describe("accepted application", () => {
  test("returns 201 with a server-minted reference in the agreed format", async () => {
    mockTurnstile();
    const res = await handleApplicationIntake(post(validBody()), intakeEnv());
    expect(res.status).toBe(201);
    const body = await res.json<{ reference: string; received_at: string }>();
    expect(body.reference).toMatch(/^FC-APP-\d{8}-[0-9A-F]{6}$/);
    expect(body.received_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("the server reference is not the client's", async () => {
    mockTurnstile();
    const claimed = "FC-APP-19990101-DEADBE";
    const res = await handleApplicationIntake(post(validBody({ client_reference: claimed })), intakeEnv());
    const body = await res.json<{ reference: string }>();
    expect(body.reference).not.toBe(claimed);

    const row = await (env.DB as D1Database)
      .prepare("SELECT reference, client_reference FROM commercial_applications")
      .first<{ reference: string; client_reference: string | null }>();
    expect(row?.reference).toBe(body.reference);
    expect(row?.client_reference).toBe(claimed);
  });

  test("a malformed client reference is nulled, never stored raw", async () => {
    mockTurnstile();
    await handleApplicationIntake(post(validBody({ client_reference: "../../etc/passwd" })), intakeEnv());
    const row = await (env.DB as D1Database)
      .prepare("SELECT client_reference FROM commercial_applications")
      .first<{ client_reference: string | null }>();
    expect(row?.client_reference).toBeNull();
  });

  test("the row is born in the canonical operational state", async () => {
    mockTurnstile();
    await handleApplicationIntake(post(validBody()), intakeEnv());
    const row = await (env.DB as D1Database)
      .prepare("SELECT status FROM commercial_applications")
      .first<{ status: string }>();
    expect(row?.status).toBe("APPLICATION_RECEIVED");
  });

  test("no IP address, user agent or header value reaches the row", async () => {
    mockTurnstile();
    await handleApplicationIntake(post(validBody()), intakeEnv());
    const row = await (env.DB as D1Database)
      .prepare("SELECT * FROM commercial_applications")
      .first<Record<string, unknown>>();
    const serialised = JSON.stringify(row);
    expect(serialised).not.toContain("203.0.113.7");
    expect(serialised).not.toContain("Mozilla");
  });

  test("purge_after is exactly received_at plus 90 days", async () => {
    mockTurnstile();
    await handleApplicationIntake(post(validBody()), intakeEnv());
    const row = await (env.DB as D1Database)
      .prepare("SELECT received_at, purge_after FROM commercial_applications")
      .first<{ received_at: string; purge_after: string }>();
    const delta = Date.parse(row!.purge_after) - Date.parse(row!.received_at);
    expect(delta).toBe(90 * 24 * 60 * 60 * 1000);
  });
});

// ─── retention ────────────────────────────────────────────────────────────────

describe("purge", () => {
  async function seed(reference: string, purgeAfter: string | null) {
    await (env.DB as D1Database)
      .prepare(
        `INSERT INTO commercial_applications
         (reference, service, company, contact_name, contact_email, contact_role,
          workflow, stack, failure_mode, acceptance, timeline, environment,
          sensitivity, authority, acknowledged, received_at, purge_after)
         VALUES (?, 'assessment', 'C', 'N', 'e@x.com', 'R', 'w', 's', 'f', 'a',
                 'Within 30 days', 'Staging / test', 'Internal business data',
                 'I can approve this engagement', 1, '2026-01-01T00:00:00.000Z', ?)`,
      )
      .bind(reference, purgeAfter)
      .run();
  }

  test("an expired unconverted row is deleted", async () => {
    await seed("FC-APP-20260101-AAAAAA", "2026-04-01T00:00:00.000Z");
    expect(await purgeExpiredApplications(intakeEnv(), "2026-09-22T00:00:00.000Z")).toBe(1);
    expect(await rowCount()).toBe(0);
  });

  test("a converted row with NULL purge_after survives", async () => {
    await seed("FC-APP-20260101-BBBBBB", null);
    expect(await purgeExpiredApplications(intakeEnv(), "2026-09-22T00:00:00.000Z")).toBe(0);
    expect(await rowCount()).toBe(1);
  });

  test("a row whose window has not elapsed survives", async () => {
    await seed("FC-APP-20260101-CCCCCC", "2027-01-01T00:00:00.000Z");
    expect(await purgeExpiredApplications(intakeEnv(), "2026-09-22T00:00:00.000Z")).toBe(0);
    expect(await rowCount()).toBe(1);
  });

  test("a mixed table purges only what has expired", async () => {
    await seed("FC-APP-20260101-DDDDDD", "2026-04-01T00:00:00.000Z");
    await seed("FC-APP-20260101-EEEEEE", null);
    await seed("FC-APP-20260101-FFFFFF", "2027-01-01T00:00:00.000Z");
    expect(await purgeExpiredApplications(intakeEnv(), "2026-09-22T00:00:00.000Z")).toBe(1);
    expect(await rowCount()).toBe(2);
  });
});

// ─── funnel projection ────────────────────────────────────────────────────────

describe("funnel stage is derived, not stored", () => {
  test("every operational state maps to a funnel stage", () => {
    for (const state of OPERATIONAL_STATES) {
      expect(funnelStageFor(state), `no funnel stage for ${state}`).toBeTruthy();
    }
  });

  test("the operational distinctions the funnel collapses are preserved upstream", () => {
    expect(funnelStageFor("SCOPE_APPROVED")).toBe("service_order");
    expect(funnelStageFor("CONTRACT_SENT")).toBe("service_order");
    expect(OPERATIONAL_STATES).toContain("SCOPE_APPROVED");
    expect(OPERATIONAL_STATES).toContain("CONTRACT_SENT");
  });

  test("INVOICE_ISSUED exists and is distinct from payment pending", () => {
    expect(OPERATIONAL_STATES).toContain("INVOICE_ISSUED");
    expect(funnelStageFor("INVOICE_ISSUED")).toBe("invoiced");
    expect(funnelStageFor("DEPOSIT_PENDING")).toBe("invoiced");
    expect(funnelStageFor("DEPOSIT_CLEARED")).toBe("paid");
  });

  test("states with no funnel equivalent report themselves as out-of-funnel", () => {
    for (const state of ["CLARIFICATION_REQUIRED", "PAUSED", "CANCELLED", "DISPUTED"]) {
      expect(funnelStageFor(state)).toBe("out_of_funnel");
    }
    expect(funnelStageFor("DECLINED")).toBe("declined");
  });

  test("an unknown state does not silently become a valid stage", () => {
    expect(funnelStageFor("NOT_A_STATE")).toBe("unknown");
  });
});
