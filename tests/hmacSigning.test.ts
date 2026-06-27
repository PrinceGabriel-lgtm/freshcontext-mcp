import test from "node:test";
import assert from "node:assert/strict";
import workerIntelligence from "../worker/src/intelligence.ts";

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
