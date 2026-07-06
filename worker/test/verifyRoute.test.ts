import { env, SELF } from "cloudflare:test";
import { describe, test, expect, beforeAll } from "vitest";
import { buildHaPriPayloadV3 } from "../../src/core/index.js";
import { hmacSha256 } from "../src/intelligence.js";

// Must equal the FC_HMAC_SECRET binding in vitest.config.mts so the Worker's verify
// path recomputes the same HMAC we sign the seeded row with.
const SECRET = "miniflare-integration-secret-not-prod";

// ─── Integration test for the MOUNTED /v1 route (F3) ───────────────────────────
//
// This is the test that would have caught F1. It drives the REAL Worker fetch handler
// over SELF.fetch — real isBotProbe → real isAllowedRoute → the real /v1 mount block →
// real handleRestRequest → real handleVerify → real HMAC — against a REAL local D1.
// Nothing here calls handleRestRequest in isolation and nothing reimplements the
// route dispatch; if the mount regresses (drops out of isAllowedRoute or the fetch
// switch), these go red.

// Mirrors worker/migrations/0001_evaluation_snapshots.sql (columns the row needs).
const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS evaluation_snapshots (
  id TEXT PRIMARY KEY,
  verdict_id TEXT NOT NULL,
  result_id TEXT,
  signal_source TEXT NOT NULL,
  signal_source_type TEXT NOT NULL,
  signal_published_at TEXT,
  decision TEXT NOT NULL,
  decision_label TEXT NOT NULL,
  source_profile_id TEXT,
  intent_profile_id TEXT,
  evaluated_at TEXT NOT NULL,
  revalidate_after TEXT,
  engine_version TEXT NOT NULL,
  canonical_content_sha256 TEXT,
  signing_payload TEXT NOT NULL,
  signature TEXT NOT NULL,
  signature_version TEXT NOT NULL DEFAULT 'FRESHCONTEXT_HA_PRI_V3',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);`;

const SEED = {
  id: "integration-row-0001",
  verdict_id: "cb1a2b1e64fc1814de0b4c4c8bf7c33c36f8da2aa0a06d0088baf23d98ee2a85",
  result_id: "fc-integration-001",
  content: "Integration test content — hashed, signed, stored, verified over the real route.",
  adapter: "arxiv",
  published_at: "2026-06-01T00:00:00.000Z",
  retrieved_at: "2026-06-29T10:00:00.000Z",
  evaluated_at: "2026-06-29T10:00:05.000Z",
  engine_version: "0.4.0",
  decision: "use_first",
};

let payload: string;
let signature: string;

function post(body: unknown): Request {
  return new Request("https://freshcontext.test/v1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  await env.DB.exec(CREATE_TABLE.replace(/\n/g, " ").trim());

  // Build the v3 payload with the SAME builder the handler uses, sign it with the
  // SAME secret the Worker binding carries. This is a real stored row, not a fake.
  payload = buildHaPriPayloadV3({
    resultId: SEED.result_id,
    rawContent: SEED.content,
    semanticFingerprint: null,
    adapter: SEED.adapter,
    publishedAt: SEED.published_at,
    retrievedAt: SEED.retrieved_at,
    engineVersion: SEED.engine_version,
    verdictId: SEED.verdict_id,
    decision: SEED.decision,
  });
  signature = await hmacSha256(SECRET, payload);

  await env.DB.prepare(
    "INSERT INTO evaluation_snapshots " +
    "(id, verdict_id, result_id, signal_source, signal_source_type, signal_published_at, " +
    "decision, decision_label, source_profile_id, intent_profile_id, evaluated_at, " +
    "revalidate_after, engine_version, canonical_content_sha256, signing_payload, " +
    "signature, signature_version, created_at) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(
    SEED.id, SEED.verdict_id, SEED.result_id, "https://arxiv.org/abs/2606.integration001",
    SEED.adapter, SEED.published_at, SEED.decision, "Use first", "academic_research",
    "citation_check", SEED.evaluated_at, null, SEED.engine_version, null,
    payload, signature, "FRESHCONTEXT_HA_PRI_V3", "2026-06-29T10:00:05.000Z"
  ).run();
});

describe("mounted /v1 route — real Worker fetch (F3)", () => {
  test("GET /v1/health → 200 {ok:true, version:0.4.0}", async () => {
    const r = await SELF.fetch("https://freshcontext.test/v1/health");
    expect(r.status).toBe(200);
    const body = await r.json() as { ok: boolean; version: string };
    expect(body.ok).toBe(true);
    expect(body.version).toBe("0.4.0");
  });

  test("Mode 1: valid payload + signature → valid", async () => {
    const r = await SELF.fetch(post({ signing_payload: payload, signature }));
    expect(r.status).toBe(200);
    const body = await r.json() as { status: string };
    expect(body.status).toBe("valid");
  });

  test("Mode 1: tampered payload → invalid", async () => {
    const tampered = payload.replace("decision=use_first", "decision=exclude");
    const r = await SELF.fetch(post({ signing_payload: tampered, signature }));
    const body = await r.json() as { status: string };
    expect(body.status).toBe("invalid");
  });

  test("Mode 2: seeded verdict_id verifies against the STORED row in real D1 → valid", async () => {
    const r = await SELF.fetch(post({ verdict_id: SEED.verdict_id }));
    expect(r.status).toBe(200);
    const body = await r.json() as {
      status: string; matched_rows: number; engine_version: string; signature_version: string;
    };
    expect(body.status).toBe("valid");
    expect(body.matched_rows).toBe(1);
    expect(body.engine_version).toBe("0.4.0");
    expect(body.signature_version).toBe("FRESHCONTEXT_HA_PRI_V3");
  });

  test("Mode 2b: seeded id verifies the exact row → valid", async () => {
    const r = await SELF.fetch(post({ id: SEED.id }));
    const body = await r.json() as { status: string; matched_rows: number };
    expect(body.status).toBe("valid");
    expect(body.matched_rows).toBe(1);
  });

  test("Mode 2: unknown verdict_id → unknown, matched_rows 0", async () => {
    const r = await SELF.fetch(post({ verdict_id: "f".repeat(64) }));
    const body = await r.json() as { status: string; matched_rows: number };
    expect(body.status).toBe("unknown");
    expect(body.matched_rows).toBe(0);
  });

  test("/v1/evaluate is NOT mounted → 404, never reaches the engine", async () => {
    const r = await SELF.fetch(new Request("https://freshcontext.test/v1/evaluate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signal: { source: "x", content: "y" } }),
    }));
    expect(r.status).toBe(404);
  });
});
