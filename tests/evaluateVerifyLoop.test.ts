import test, { describe, before } from "node:test";
import assert from "node:assert/strict";
import { evaluateContextInput } from "../src/tools/evaluateContext.js";
import type { EvaluateContextResult } from "../src/tools/evaluateContext.js";
import { buildHaPriPayloadV3 } from "../src/core/index.js";
import type { ContextDecisionResult } from "../src/core/index.js";
import { handleRestRequest } from "../src/rest/handler.js";
import workerIntelligence from "../worker/src/intelligence.ts";

const { hmacSha256 } = workerIntelligence;

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const SERVICE_VERSION = "0.3.23";
// Test key: obviously fake. The only thing faked in this end-to-end test.
const TEST_KEY = "freshcontext-test-integration-key-do-not-use";

// Fixed signal — same inputs → same verdict_id every run (determinism invariant).
// URL-based source ensures result_id is derivable; content ensures signing runs.
const SIGNAL = {
  id: "e2e-loop-test-001",
  source: "https://arxiv.org/abs/2606.e2eloop001",
  source_type: "arxiv" as const,
  title: "End-to-end evaluate→verify loop test signal",
  content: "FreshContext end-to-end loop test. This content is hashed, signed, and verified.",
  published_at: "2026-06-01T00:00:00.000Z",
  retrieved_at: "2026-06-29T10:00:00.000Z",
  semantic_score: 0.92,
  date_confidence: "high" as const,
};

function postVerify(body: unknown): Request {
  return new Request("https://freshcontext.test/v1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ─── End-to-end loop ──────────────────────────────────────────────────────────
//
// Prove: evaluate_context produces a v3 signed verdict → /v1/verify accepts it.
//
// The seam this test guards: the payload string that the handler stores in the
// snapshot row must be IDENTICAL to the string the verify path recomputes HMAC
// over. If those ever diverge (different canonical form, different field order,
// missing field), the loop breaks and this test goes red.
//
// Real at every seam:
//   - evaluateContextInput          (real Core engine, not a hand-built result)
//   - buildHaPriPayloadV3           (real Core builder, not a hardcoded string)
//   - handleRestRequest /v1/verify  (real REST handler, not an internal helper)
//   - hmacSha256                    (real Worker HMAC, same routine handler uses)
// Only fake: the HMAC key (obviously fake, never used in production).

describe("Pass 23 Brick 5 — evaluate → v3 snapshot → verify loop", () => {
  let result: EvaluateContextResult;
  let decision: ContextDecisionResult;
  let resultId: string;
  let v3Payload: string;
  let v3Sig: string;

  before(async () => {
    // ── Step 1: EVALUATE — real Core engine, not a mocked result ──────────
    result = evaluateContextInput({
      profile: "academic_research",
      intent: "citation_check",
      signals: [SIGNAL],
    });

    const item = result.items[0];
    decision = item.decision;
    const signal = item.evaluation.signal;
    resultId = item.evaluation.provenance_readiness.source_identity.result_id ?? "";

    // Pre-flight: confirm the item meets the handler's write guards.
    // If any of these fail, the loop can't run — stop early with a clear message.
    assert.ok(signal.content, "test signal must have content (signing guard)");
    assert.ok(resultId, "test signal must produce a result_id (signing guard)");
    assert.ok(decision.verdict_id, "decision must carry a verdict_id");
    assert.ok(
      typeof decision.verdict_id === "string" && /^[0-9a-f]{64}$/.test(decision.verdict_id),
      "verdict_id must be a 64-char hex string"
    );

    // ── Step 2: BUILD V3 PAYLOAD — same inputs and same function the handler uses
    v3Payload = buildHaPriPayloadV3({
      resultId,
      rawContent: signal.content,
      semanticFingerprint: null,         // evaluate_context never populates this
      adapter: signal.source_type,
      publishedAt: signal.published_at,
      retrievedAt: signal.retrieved_at,
      engineVersion: SERVICE_VERSION,
      verdictId: decision.verdict_id,
      decision: decision.decision,
    });
    v3Sig = await hmacSha256(TEST_KEY, v3Payload);
  });

  // ─── The loop — positive path ────────────────────────────────────────────

  test("evaluate output signed with test key → /v1/verify with same key → status:valid", async () => {
    // This is the seam: evaluate builds v3Payload from real Core output; verify
    // recomputes HMAC(TEST_KEY, v3Payload) and compares. They must match.
    const resp = await handleRestRequest(
      postVerify({ signing_payload: v3Payload, signature: v3Sig }),
      TEST_KEY
    );
    const body = await resp.json() as { status: string; reasons: string[] };
    assert.equal(resp.status, 200);
    assert.equal(
      body.status, "valid",
      "the signature produced from evaluate's real output must be accepted by the real verify path"
    );
    assert.deepEqual(body.reasons, []);
  });

  // ─── Negative path 1: tamper the decision in the signed payload ──────────

  test("decision flipped in payload, old sig kept → status:invalid (v3 verdict binding works)", async () => {
    // The v3 payload has a line: decision=<value>
    // Replacing it with a different decision value changes the HMAC input bytes
    // → the stored signature no longer matches → verify must return invalid.
    const tamperedPayload = v3Payload.replace(/^decision=.+$/m, "decision=tampered_value");
    assert.notEqual(tamperedPayload, v3Payload, "sanity: tamper must produce a different string");

    const resp = await handleRestRequest(
      postVerify({ signing_payload: tamperedPayload, signature: v3Sig }),
      TEST_KEY
    );
    const body = await resp.json() as { status: string };
    assert.equal(
      body.status, "invalid",
      "flipping the decision must break the HMAC — the verdict IS bound to the signed bytes"
    );
  });

  // ─── Negative path 2: tamper the verdict_id in the signed payload ────────

  test("verdict_id swapped in payload, old sig kept → status:invalid", async () => {
    const tamperedPayload = v3Payload.replace(
      /^verdict_id=.+$/m,
      "verdict_id=" + "b".repeat(64)
    );
    assert.notEqual(tamperedPayload, v3Payload);

    const resp = await handleRestRequest(
      postVerify({ signing_payload: tamperedPayload, signature: v3Sig }),
      TEST_KEY
    );
    const body = await resp.json() as { status: string };
    assert.equal(body.status, "invalid");
  });

  // ─── Negative path 3: correct payload, wrong verify key ─────────────────

  test("correct payload, different key on verify side → status:invalid", async () => {
    // The signature was produced with TEST_KEY. Verifying with a different key
    // produces a different expected HMAC → mismatch.
    const resp = await handleRestRequest(
      postVerify({ signing_payload: v3Payload, signature: v3Sig }),
      "completely-different-key-no-match"
    );
    const body = await resp.json() as { status: string };
    assert.equal(body.status, "invalid",
      "key mismatch on the verify side must produce invalid, not valid");
  });

  // ─── Negative path 4: missing signature → unknown ────────────────────────

  test("missing signature → status:unknown (three-state contract)", async () => {
    const resp = await handleRestRequest(
      postVerify({ signing_payload: v3Payload }),
      TEST_KEY
    );
    const body = await resp.json() as { status: string };
    assert.equal(body.status, "unknown",
      "missing signature must return unknown, not invalid — mirrors verifyHaPriV2 contract");
  });

  // ─── Negative path 5: signature from a different verdict ─────────────────

  test("cross-verdict signature (same key, different payload) → status:invalid", async () => {
    // Build a completely different v3 payload (different verdict), sign it with the same key.
    // Use the resulting signature to try to verify the ORIGINAL payload.
    // A valid system must reject this — the signature is tied to its specific payload.
    const differentPayload = buildHaPriPayloadV3({
      resultId,
      rawContent: SIGNAL.content,
      semanticFingerprint: null,
      adapter: SIGNAL.source_type,
      publishedAt: SIGNAL.published_at,
      retrievedAt: SIGNAL.retrieved_at,
      engineVersion: SERVICE_VERSION,
      verdictId: "c".repeat(64),           // different verdict_id
      decision: "exclude",                  // different decision
    });
    const differentSig = await hmacSha256(TEST_KEY, differentPayload);
    assert.notEqual(differentSig, v3Sig,
      "sanity: signature over different payload must differ");

    const resp = await handleRestRequest(
      postVerify({ signing_payload: v3Payload, signature: differentSig }),
      TEST_KEY
    );
    const body = await resp.json() as { status: string };
    assert.equal(body.status, "invalid",
      "a signature from a different verdict cannot validate a different payload");
  });

  // ─── Seam integrity: determinism ─────────────────────────────────────────

  test("rebuilding v3 payload from the same evaluate inputs is byte-identical (no canonical drift)", () => {
    // If this fails, the payload string is not deterministic. The handler would store
    // a different string from what verify recomputes → the loop would be structurally broken.
    const item = result.items[0];
    const signal = item.evaluation.signal;
    const rebuilt = buildHaPriPayloadV3({
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
    assert.equal(rebuilt, v3Payload,
      "v3 payload must be fully deterministic — same inputs → same bytes → same signature");
  });

  // ─── verdict_id is deterministic (same signal always produces same verdict) ─

  test("verdict_id is deterministic for fixed inputs (same evaluate call → same id)", () => {
    // Run evaluate again with the same inputs. verdict_id must match.
    const secondResult = evaluateContextInput({
      profile: "academic_research",
      intent: "citation_check",
      signals: [SIGNAL],
    });
    const secondDecision = secondResult.items[0].decision;
    assert.equal(
      secondDecision.verdict_id, decision.verdict_id,
      "verdict_id must be deterministic — same inputs → same fingerprint"
    );
  });
});
