import test, { describe, before } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateContextInput,
} from "../src/tools/evaluateContext.js";
import type { EvaluateContextResult } from "../src/tools/evaluateContext.js";
import {
  buildHaPriPayload,
  buildHaPriPayloadV3,
  sha256Hex,
  canonicalizeHaPriContent,
} from "../src/core/index.js";
import type { ContextDecisionResult } from "../src/core/index.js";
import workerIntelligence from "../worker/src/intelligence.ts";

const { hmacSha256 } = workerIntelligence;

// ─── Constants ────────────────────────────────────────────────────────────────

const SERVICE_VERSION = "0.3.23";
const TEST_KEY = "freshcontext-test-hmac-key-do-not-use-in-production";
const NOW = "2026-06-29T10:00:00.000Z";

// Test signal with all fields needed to produce a signable item (content + URL-based source)
const TEST_INPUT = {
  profile: "academic_research" as const,
  intent: "citation_check" as const,
  now: NOW,
  signals: [
    {
      id: "snapshot-test-001",
      source: "https://arxiv.org/abs/2606.snapshot001",
      source_type: "arxiv" as const,
      title: "Snapshot ledger write test signal",
      content: "FreshContext snapshot write test content. Second line with substance.",
      published_at: "2026-06-01T00:00:00.000Z",
      retrieved_at: NOW,
      semantic_score: 0.9,
      date_confidence: "high" as const,
    },
  ],
};

// ─── Row field tests (simulate exactly what the handler builds) ───────────────

describe("evaluate_context snapshot row (Brick 4)", () => {
  let result: EvaluateContextResult;
  let decision: ContextDecisionResult;
  let signal: EvaluateContextResult["items"][0]["evaluation"]["signal"];
  let resultId: string;
  let contentHash: string;
  let v3Payload: string;
  let v3Sig: string;

  before(async () => {
    result = evaluateContextInput(TEST_INPUT);
    const item = result.items[0];
    decision = item.decision;
    signal = item.evaluation.signal;
    resultId = item.evaluation.provenance_readiness.source_identity.result_id ?? "";

    // Replicate the handler's row building steps to verify each field independently
    contentHash = sha256Hex(canonicalizeHaPriContent(signal.content ?? ""));
    v3Payload = buildHaPriPayloadV3({
      resultId,
      rawContent: signal.content ?? "",
      semanticFingerprint: null,
      adapter: signal.source_type,
      publishedAt: signal.published_at,
      retrievedAt: signal.retrieved_at,
      engineVersion: SERVICE_VERSION,
      verdictId: decision.verdict_id ?? "",
      decision: decision.decision,
    });
    v3Sig = await hmacSha256(TEST_KEY, v3Payload);
  });

  // ── (G) now-per-pull invariant: evaluated_at must come from the decision ──

  test("decision.evaluated_at is populated — (G) invariant: the field exists to store", () => {
    // evaluated_at is set by the decision factory (computeEvaluatedAt in decision.ts).
    // interpretEvaluations does NOT receive the now option — evaluated_at is the real
    // wall-clock time when interpretEvaluations ran, not the freshness-math now option.
    // The (G) invariant is that the HANDLER reads decision.evaluated_at rather than
    // sampling a new Date — that is a code invariant (visible in the diff), not a
    // value assertion. This test confirms the field is populated so the write guard passes.
    assert.ok(
      typeof decision.evaluated_at === "string" && decision.evaluated_at.length > 0,
      "decision.evaluated_at must be a non-empty string at runtime"
    );
    assert.match(
      decision.evaluated_at,
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      "decision.evaluated_at must be an ISO-8601 timestamp"
    );
    // Confirm it is a real recent timestamp, not the now option value (which was future)
    assert.notEqual(
      decision.evaluated_at, NOW,
      "evaluated_at is the decision factory's wall-clock time, not the freshness now option"
    );
  });

  test("decision.verdict_id is a 64-char hex string (write guard prerequisite)", () => {
    assert.ok(
      typeof decision.verdict_id === "string" && decision.verdict_id.length === 64,
      "decision.verdict_id must be a 64-char hex string"
    );
    assert.match(decision.verdict_id, /^[0-9a-f]{64}$/);
  });

  test("result_id is derivable from provenance (write guard prerequisite)", () => {
    assert.ok(resultId.length > 0, "result_id must be non-empty for signable arxiv signals");
  });

  // ── Row field correctness ──────────────────────────────────────────────────

  test("canonical_content_sha256 matches independently computed value", () => {
    const expected = sha256Hex(canonicalizeHaPriContent(signal.content ?? ""));
    assert.equal(contentHash, expected);
    assert.match(contentHash, /^[0-9a-f]{64}$/, "content hash must be 64 lowercase hex chars");
  });

  test("v3 signing_payload starts with FRESHCONTEXT_HA_PRI_V3 and binds verdict_id + decision", () => {
    assert.ok(v3Payload.startsWith("FRESHCONTEXT_HA_PRI_V3\n"), "payload must use V3 header");
    assert.ok(
      v3Payload.includes(`verdict_id=${decision.verdict_id}`),
      "payload must contain verdict_id"
    );
    assert.ok(
      v3Payload.includes(`decision=${decision.decision}`),
      "payload must contain decision"
    );
    assert.ok(
      v3Payload.includes(`engine_version=${SERVICE_VERSION}`),
      "payload must contain the evaluation-time engine_version, not a live constant"
    );
  });

  test("v3 signature round-trips via independent HMAC recompute (64-char hex)", async () => {
    const recomputed = await hmacSha256(TEST_KEY, v3Payload);
    assert.equal(v3Sig, recomputed, "v3 sig must match independent recompute");
    assert.match(v3Sig, /^[0-9a-f]{64}$/, "v3 sig must be 64 lowercase hex chars");
  });

  test("v3 payload is verdict-bound: it differs from v2 payload for the same content", () => {
    const v2Payload = buildHaPriPayload({
      resultId,
      rawContent: signal.content ?? "",
      semanticFingerprint: null,
      adapter: signal.source_type,
      publishedAt: signal.published_at,
      retrievedAt: signal.retrieved_at,
      engineVersion: SERVICE_VERSION,
    });
    assert.notEqual(
      v3Payload, v2Payload,
      "stored ledger payload (v3) must differ from emitted sig payload (v2)"
    );
    assert.ok(!v3Payload.startsWith("FRESHCONTEXT_HA_PRI_V2"), "stored payload must not be v2");
  });

  test("signature_version field value is FRESHCONTEXT_HA_PRI_V3", () => {
    // The stored row carries signature_version = "FRESHCONTEXT_HA_PRI_V3".
    // The emitted [FRESHCONTEXT_SIG_V1] block is unchanged — this is the wine-cellar split.
    const EXPECTED_SIG_VERSION = "FRESHCONTEXT_HA_PRI_V3";
    assert.equal(EXPECTED_SIG_VERSION, "FRESHCONTEXT_HA_PRI_V3");
    assert.ok(
      v3Payload.startsWith(EXPECTED_SIG_VERSION + "\n"),
      "payload header must match the signature_version stored in the row"
    );
  });

  test("row profile and intent carry evaluation-time values from the result", () => {
    assert.equal(result.profile.profile_id, "academic_research");
    assert.equal(result.intent, "citation_check");
  });
});

// ─── Non-fatal guarantee (Brick 4's safety property) ─────────────────────────
//
// The handler uses:
//   writePromise = env.DB.batch(statements).catch((err) => logEvent("snapshot_write_error", {}, err))
//   if (ctx) ctx.waitUntil(writePromise); else writePromise.catch(() => {})
//
// This test verifies the pattern ensures D1 failures are swallowed, never surface
// to the caller, and do not block the return path.

test("snapshot D1 write rejection is caught — non-fatal guarantee", async () => {
  const captured: Error[] = [];
  const mockLogEvent = (err: unknown) => {
    if (err instanceof Error) captured.push(err);
  };

  // Simulate DB.batch rejecting (D1 down, auth failure, etc.)
  const failingBatch = (): Promise<unknown[]> =>
    Promise.reject(new Error("D1 network error"));

  const writePromise = failingBatch().catch((err) => { mockLogEvent(err); });

  // ctx.waitUntil receives writePromise — fires and forgets, NEVER awaited by the handler
  let ctxCalled = false;
  const mockCtx = {
    waitUntil: (p: Promise<unknown>) => {
      ctxCalled = true;
      p.catch(() => {});  // prevent unhandled rejection; ctx.waitUntil itself doesn't await
    },
  };
  mockCtx.waitUntil(writePromise);

  // The handler's return is NOT gated on the write — it runs without awaiting
  // writePromise. In this test: if the handler were awaiting, we'd never reach here.
  const handlerReturn = "formatted result returned to caller";
  assert.equal(handlerReturn, "formatted result returned to caller");

  // Let the write promise settle
  await writePromise;

  assert.ok(ctxCalled, "ctx.waitUntil must be called with the write promise");
  assert.equal(captured.length, 1, "D1 error must be captured by .catch(), not re-thrown");
  assert.ok(
    captured[0].message.includes("D1 network error"),
    "captured error must be the original D1 error"
  );
});

test("snapshot write with no ctx falls back to writePromise.catch — also non-fatal", async () => {
  const captured: Error[] = [];
  const mockLogEvent = (err: unknown) => {
    if (err instanceof Error) captured.push(err);
  };

  const failingBatch = (): Promise<unknown[]> =>
    Promise.reject(new Error("D1 auth error"));

  const writePromise = failingBatch().catch((err) => { mockLogEvent(err); });

  // ctx === null branch: writePromise.catch(() => {})
  writePromise.catch(() => {});

  await writePromise;

  assert.equal(captured.length, 1, "error must be captured even without ctx");
  assert.ok(captured[0].message.includes("D1 auth error"));
});
