import test from "node:test";
import assert from "node:assert/strict";
import workerIntelligence from "../worker/src/intelligence.ts";
import {
  evaluateContextInput,
  formatEvaluateContextResult,
} from "../src/tools/evaluateContext.js";
import type { EvaluateContextResult } from "../src/tools/evaluateContext.js";
import { buildHaPriPayload } from "../src/core/index.js";

const { hmacSha256 } = workerIntelligence;

// ─── Test fixtures ───────────────────────────────────────────────────────────

// Test key: obviously fake, committed only for test purposes, never used in production.
const TEST_KEY = "freshcontext-test-hmac-key-do-not-use-in-production";

// The "valid basic payload" signing payload from tests/fixtures/ha-pri-v2-golden-vectors.json.
// Using an authentic canonical payload rather than a synthetic one proves the HMAC function
// operates correctly on the actual strings the signing path will produce.
const TEST_PAYLOAD =
  "FRESHCONTEXT_HA_PRI_V2\n" +
  "result_id=fc-test-001\n" +
  "canonical_content_sha256=9f4e132a2f45f5694e782f3f6bfcd6f5234f718e398100392244ae260f803a07\n" +
  "semantic_fingerprint_sha256=6f8ba42b67507f500f2b88e3aa740e88d8db696e93430f31eb7d76525a37844c\n" +
  "adapter=arxiv\n" +
  "published_at=2026-05-20T00:00:00.000Z\n" +
  "retrieved_at=2026-06-09T12:00:00.000Z\n" +
  "engine_version=0.3.19";

// Ground truth: computed independently with Node's createHmac("sha256", TEST_KEY) before
// this file was written — not captured from a first run of hmacSha256 itself.
// Verify: node -e "const {createHmac}=require('crypto');
//   console.log(createHmac('sha256','freshcontext-test-hmac-key-do-not-use-in-production')
//     .update('<TEST_PAYLOAD>','utf8').digest('hex'))"
const EXPECTED_HMAC = "1432aabc6a4d02e5f0926a7b57c5cd30e0260a45223f691d2f0618087847af7e";

// ─── Tests ───────────────────────────────────────────────────────────────────

test("hmacSha256 produces the pre-computed HMAC-SHA256 golden vector", async () => {
  const result = await hmacSha256(TEST_KEY, TEST_PAYLOAD);
  assert.equal(result, EXPECTED_HMAC);
});

test("hmacSha256 output is 64 lowercase hex chars (SHA-256 = 32 bytes)", async () => {
  const result = await hmacSha256(TEST_KEY, TEST_PAYLOAD);
  assert.equal(result.length, 64);
  assert.match(result, /^[a-f0-9]{64}$/);
});

test("hmacSha256 with a different key produces a different signature (unforgeability)", async () => {
  const correct = await hmacSha256(TEST_KEY, TEST_PAYLOAD);
  const wrong = await hmacSha256("wrong-key", TEST_PAYLOAD);
  assert.notEqual(correct, wrong);
});

// ─── 22-C: evaluate_context signing integration ───────────────────────────────

// ENGINE_VERSION must match SERVICE_VERSION in worker/src/worker.ts. If the version
// bumps, update this constant so the signing path stays coherent.
const ENGINE_VERSION = "0.3.23";
const SIGN_NOW = "2026-06-27T00:00:00.000Z";

// Mirrors the handler's per-item signing loop. Used to test the logic contract —
// not the same code path, but the same algorithm over the same inputs.
async function buildSigBlock(
  result: EvaluateContextResult,
  secret: string
): Promise<string | null> {
  const sigLines: string[] = [];
  for (let i = 0; i < result.items.length; i++) {
    const { signal, provenance_readiness } = result.items[i].evaluation;
    const resultId = provenance_readiness.source_identity.result_id;
    if (!signal.content || !resultId) continue;
    const payload = buildHaPriPayload({
      resultId,
      rawContent: signal.content,
      semanticFingerprint: null,
      adapter: signal.source_type,
      publishedAt: signal.published_at,
      retrievedAt: signal.retrieved_at,
      engineVersion: ENGINE_VERSION,
    });
    const sig = await hmacSha256(secret, payload);
    sigLines.push(`item=${i + 1} result_id=${resultId} sig=${sig}`);
  }
  if (sigLines.length === 0) return null;
  return [
    "[FRESHCONTEXT_SIG_V1]",
    "algo=HMAC-SHA256",
    ...sigLines,
    "[/FRESHCONTEXT_SIG_V1]",
  ].join("\n");
}

test("evaluate_context signing: FC_HMAC_SECRET set → [FRESHCONTEXT_SIG_V1] block with independently recomputed sig", async () => {
  const result = evaluateContextInput({
    profile: "academic_research",
    intent: "citation_check",
    signals: [{
      id: "fc-sign-test-001",
      source: "https://arxiv.org/abs/2026.sign001",
      content: "Signing integration test: content used to construct ha-pri payload.",
    }],
    now: SIGN_NOW,
  });
  const formatted = formatEvaluateContextResult(result);
  const sigBlock = await buildSigBlock(result, TEST_KEY);

  assert.ok(sigBlock !== null, "signal with content and usable source must produce a sig block");
  const signedOutput = formatted + "\n" + sigBlock;

  assert.ok(signedOutput.includes("[FRESHCONTEXT_SIG_V1]"), "must contain sig block open tag");
  assert.ok(signedOutput.includes("[/FRESHCONTEXT_SIG_V1]"), "must contain sig block close tag");
  assert.ok(signedOutput.includes("algo=HMAC-SHA256"), "must declare signing algorithm");

  // Independent recompute: build the payload directly and sign it. This is independent
  // of buildSigBlock — if either has a bug the assertion catches it.
  const { signal, provenance_readiness } = result.items[0].evaluation;
  const resultId = provenance_readiness.source_identity.result_id;
  assert.ok(resultId, "test signal with URL source must resolve a result_id");
  assert.ok(signal.content, "test signal must carry content through evaluation");

  const expectedPayload = buildHaPriPayload({
    resultId,
    rawContent: signal.content!,
    semanticFingerprint: null,
    adapter: signal.source_type,
    publishedAt: signal.published_at,
    retrievedAt: signal.retrieved_at,
    engineVersion: ENGINE_VERSION,
  });
  const expectedSig = await hmacSha256(TEST_KEY, expectedPayload);

  assert.match(expectedSig, /^[a-f0-9]{64}$/, "independently recomputed sig must be 64 hex chars");
  assert.ok(
    signedOutput.includes(`result_id=${resultId} sig=${expectedSig}`),
    "block must contain independently recomputed HMAC for the test signal"
  );
});

test("evaluate_context signing: FC_HMAC_SECRET unset → base output has no sig block (graceful omit)", () => {
  const result = evaluateContextInput({
    profile: "academic_research",
    intent: "citation_check",
    signals: [{ source: "https://example.com/doc", content: "Content for no-sign path." }],
    now: SIGN_NOW,
  });
  const baseFormatted = formatEvaluateContextResult(result);

  // The handler returns ok(formatted) when no secret — this verifies that base output
  // is a clean, non-extended string with no sig block artifacts.
  assert.ok(!baseFormatted.includes("[FRESHCONTEXT_SIG_V1]"), "base output must contain no sig block");
  assert.ok(!baseFormatted.includes("[/FRESHCONTEXT_SIG_V1]"), "base output must contain no sig block close tag");
  assert.ok(baseFormatted.includes("[FRESHCONTEXT_EVALUATION_JSON]"), "base output must still contain evaluation JSON block");
});

test("evaluate_context signing: title-only signal (no content) → no sig, no crash", async () => {
  const result = evaluateContextInput({
    profile: "academic_research",
    intent: "citation_check",
    signals: [{ source: "https://example.com/title-only", title: "Title-only with no content" }],
    now: SIGN_NOW,
  });

  const { signal } = result.items[0].evaluation;
  assert.ok(!signal.content, "title-only signal must carry no content through evaluation");

  const sigBlock = await buildSigBlock(result, TEST_KEY);
  assert.equal(sigBlock, null, "title-only signal must produce no sig block (graceful skip)");
});

// ─── 22-D: end-to-end golden vector ──────────────────────────────────────────
//
// Pins the EXACT [FRESHCONTEXT_SIG_V1] block serialization for a fully-fixed input.
// The runtime cross-check in 22-C proves the sig is correct; this test proves the
// serialization is stable — block delimiters, algo line, item format.
//
// PINNED_SIG computed once via Node createHmac before this test was written:
//   node -e "const {createHash,createHmac}=require('crypto');
//     const sha256=s=>createHash('sha256').update(s,'utf8').digest('hex');
//     const canonical=s=>s.replace(/\r\n/g,'\n').replace(/\r/g,'\n')
//       .split('\n').map(l=>l.replace(/[ \t]+$/,'')).join('\n');
//     const payload=[
//       'FRESHCONTEXT_HA_PRI_V2','result_id=fc-golden-001',
//       'canonical_content_sha256='+sha256(canonical('<content>')),
//       'semantic_fingerprint_sha256='+sha256('null'),
//       'adapter=arxiv','published_at=2026-06-01T00:00:00.000Z',
//       'retrieved_at=2026-06-27T00:00:00.000Z','engine_version=0.3.23'
//     ].join('\n');
//     console.log(createHmac('sha256','<TEST_KEY>').update(payload,'utf8').digest('hex'))"
const GOLDEN_PINNED_SIG = "fcc491b32f799ba81603bffe9e52292c098e7e1a941ad64e8d0a834cb808e41b";
const GOLDEN_EXPECTED_BLOCK = [
  "[FRESHCONTEXT_SIG_V1]",
  "algo=HMAC-SHA256",
  `item=1 result_id=fc-golden-001 sig=${GOLDEN_PINNED_SIG}`,
  "[/FRESHCONTEXT_SIG_V1]",
].join("\n");

test("evaluate_context signing: end-to-end golden vector freezes [FRESHCONTEXT_SIG_V1] serialization", async () => {
  const result = evaluateContextInput({
    profile: "academic_research",
    intent: "citation_check",
    signals: [{
      id: "fc-golden-001",
      source: "https://arxiv.org/abs/2026.golden001",
      source_type: "arxiv",
      content: "FreshContext golden-vector signal: stable content for pinned sig test.",
      published_at: "2026-06-01T00:00:00.000Z",
      retrieved_at: "2026-06-27T00:00:00.000Z",
    }],
    now: "2026-06-27T12:00:00.000Z",
  });

  const sigBlock = await buildSigBlock(result, TEST_KEY);
  assert.equal(sigBlock, GOLDEN_EXPECTED_BLOCK);
});
