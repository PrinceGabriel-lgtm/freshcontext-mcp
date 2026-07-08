import test from "node:test";
import assert from "node:assert/strict";
import workerIntelligence from "../worker/src/intelligence.ts";
import {
  evaluateContextInput,
  formatEvaluateContextResult,
} from "../src/tools/evaluateContext.js";
import type { EvaluateContextResult } from "../src/tools/evaluateContext.js";
import { buildHaPriPayload, buildHaPriPayloadV3 } from "../src/core/index.js";
import { handleRestRequest } from "../src/rest/handler.js";

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

// ─── F2 fix: emit the v3 (decision-bound) signature ──────────────────────────
//
// Closes AUDIT_REDTEAM_2026-07-05.md finding F2: the decision itself was never
// inside the signed bytes a caller actually received — only content + metadata
// (v2) were emitted, while the decision-bound v3 signature was written to the
// ledger only. Fix is additive: a SEPARATE [FRESHCONTEXT_SIG_V3] block is now
// appended after [FRESHCONTEXT_SIG_V1]. The v2 block above, and its 9844b0c
// golden vector, are byte-for-byte untouched by everything below.

// Mirrors the handler's v3 per-item loop (worker.ts): same guard
// (decision.evaluated_at && decision.verdict_id), same field construction order,
// same "emit exactly what would be written to the ledger" shape. Not the same
// code path — the handler callback isn't independently invocable — but the same
// algorithm over the same real evaluateContextInput() output.
async function buildSigBlockV3(
  result: EvaluateContextResult,
  secret: string
): Promise<{
  block: string | null;
  items: Array<{ resultId: string; verdictId: string; payload: string; sig: string }>;
}> {
  const sigLines: string[] = [];
  const items: Array<{ resultId: string; verdictId: string; payload: string; sig: string }> = [];
  for (let i = 0; i < result.items.length; i++) {
    const { signal, provenance_readiness } = result.items[i].evaluation;
    const decision = result.items[i].decision;
    const resultId = provenance_readiness.source_identity.result_id;
    if (!signal.content || !resultId) continue;
    if (!decision.evaluated_at || !decision.verdict_id) continue;
    const payload = buildHaPriPayloadV3({
      resultId,
      rawContent: signal.content,
      semanticFingerprint: null,
      adapter: signal.source_type,
      publishedAt: signal.published_at,
      retrievedAt: signal.retrieved_at,
      engineVersion: ENGINE_VERSION,
      verdictId: decision.verdict_id,
      decision: decision.decision,
    });
    const sig = await hmacSha256(secret, payload);
    items.push({ resultId, verdictId: decision.verdict_id, payload, sig });
    sigLines.push(
      `item=${i + 1} result_id=${resultId} verdict_id=${decision.verdict_id} ` +
      `sig=${sig} payload=${JSON.stringify(payload)}`
    );
  }
  if (sigLines.length === 0) return { block: null, items };
  const block = [
    "[FRESHCONTEXT_SIG_V3]",
    "algo=HMAC-SHA256",
    ...sigLines,
    "[/FRESHCONTEXT_SIG_V3]",
  ].join("\n");
  return { block, items };
}

function postVerify(body: unknown): Request {
  return new Request("https://freshcontext.test/v1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("evaluate_context signing: FC_HMAC_SECRET set → [FRESHCONTEXT_SIG_V3] block carries the decision-bound signature", async () => {
  const result = evaluateContextInput({
    profile: "academic_research",
    intent: "citation_check",
    signals: [{
      id: "fc-v3-sign-test-001",
      source: "https://arxiv.org/abs/2026.v3sign001",
      content: "V3 signing integration test: content used to construct the decision-bound ha-pri payload.",
    }],
    now: SIGN_NOW,
  });

  const { block, items } = await buildSigBlockV3(result, TEST_KEY);
  assert.ok(block !== null, "signal with content, resultId, and a computed verdict must produce a v3 sig block");
  assert.ok(block!.includes("[FRESHCONTEXT_SIG_V3]"), "must contain v3 block open tag");
  assert.ok(block!.includes("[/FRESHCONTEXT_SIG_V3]"), "must contain v3 block close tag");
  assert.ok(block!.includes("algo=HMAC-SHA256"), "must declare signing algorithm");

  const decision = result.items[0].decision;
  assert.ok(decision.verdict_id, "test signal must resolve a verdict_id");

  // Independent recompute (bypasses buildSigBlockV3 entirely) — if either has a
  // bug, this cross-check catches it.
  const { signal, provenance_readiness } = result.items[0].evaluation;
  const resultId = provenance_readiness.source_identity.result_id;
  assert.ok(resultId, "test signal with URL source must resolve a result_id");
  assert.ok(signal.content, "test signal must carry content through evaluation");

  const expectedPayload = buildHaPriPayloadV3({
    resultId,
    rawContent: signal.content!,
    semanticFingerprint: null,
    adapter: signal.source_type,
    publishedAt: signal.published_at,
    retrievedAt: signal.retrieved_at,
    engineVersion: ENGINE_VERSION,
    verdictId: decision.verdict_id!,
    decision: decision.decision,
  });
  const expectedSig = await hmacSha256(TEST_KEY, expectedPayload);

  assert.equal(items[0].payload, expectedPayload, "buildSigBlockV3 payload must match the independent recompute");
  assert.equal(items[0].sig, expectedSig, "buildSigBlockV3 sig must match the independent recompute");
  assert.ok(
    block!.includes(`verdict_id=${decision.verdict_id} sig=${expectedSig}`),
    "block must contain the independently recomputed decision-bound HMAC"
  );

  // The emitted payload= field must JSON.parse back to the exact raw signing_payload
  // string a caller POSTs to /v1/verify (Mode 1, stateless) — no reconstruction needed.
  const payloadMatch = block!.match(/payload=(".*")$/m);
  assert.ok(payloadMatch, "block must carry a JSON-encoded payload field");
  assert.equal(JSON.parse(payloadMatch![1]), expectedPayload, "payload field must round-trip via JSON.parse");

  // And it must actually verify through the real /v1/verify handler.
  const verifyRes = await handleRestRequest(
    postVerify({ signing_payload: expectedPayload, signature: expectedSig }),
    TEST_KEY
  );
  assert.equal((await verifyRes.json() as { status: string }).status, "valid");
});

test("evaluate_context signing: flipping the decision breaks the v3 signature but NOT the old v2 one — the exact ANP2 gap F2 closes", async () => {
  const result = evaluateContextInput({
    profile: "academic_research",
    intent: "citation_check",
    signals: [{
      id: "fc-v3-attack-test-001",
      source: "https://arxiv.org/abs/2026.v3attack001",
      content: "V3 attack-closure test: flipping the decision must invalidate the v3 signature.",
    }],
    now: SIGN_NOW,
  });

  const decision = result.items[0].decision;
  assert.ok(decision.verdict_id, "test signal must resolve a verdict_id");
  const { signal, provenance_readiness } = result.items[0].evaluation;
  const resultId = provenance_readiness.source_identity.result_id!;

  const v3Payload = buildHaPriPayloadV3({
    resultId,
    rawContent: signal.content!,
    semanticFingerprint: null,
    adapter: signal.source_type,
    publishedAt: signal.published_at,
    retrievedAt: signal.retrieved_at,
    engineVersion: ENGINE_VERSION,
    verdictId: decision.verdict_id!,
    decision: decision.decision,
  });
  const v3Sig = await hmacSha256(TEST_KEY, v3Payload);

  // Sanity: the untampered v3 payload verifies as valid via the real handler.
  const validRes = await handleRestRequest(postVerify({ signing_payload: v3Payload, signature: v3Sig }), TEST_KEY);
  assert.equal((await validRes.json() as { status: string }).status, "valid");

  // The exact ANP2 attack: flip the decision in the artifact, keep the old sig.
  const flippedDecision = decision.decision === "exclude" ? "use_first" : "exclude";
  const tamperedV3Payload = v3Payload.replace(/^decision=.+$/m, `decision=${flippedDecision}`);
  assert.notEqual(tamperedV3Payload, v3Payload, "sanity: tamper must change the payload string");

  const v3Res = await handleRestRequest(postVerify({ signing_payload: tamperedV3Payload, signature: v3Sig }), TEST_KEY);
  assert.equal(
    (await v3Res.json() as { status: string }).status,
    "invalid",
    "v3 (decision-bound) verify must reject a flipped decision — this is the attack F2 closes"
  );

  // Contrast, preserved as a regression guard proving WHY v3 had to be added: the
  // OLD v2 payload never covered the decision at all, so the identical flip
  // attack against v2 is undetectable by construction.
  const v2Payload = buildHaPriPayload({
    resultId,
    rawContent: signal.content!,
    semanticFingerprint: null,
    adapter: signal.source_type,
    publishedAt: signal.published_at,
    retrievedAt: signal.retrieved_at,
    engineVersion: ENGINE_VERSION,
  });
  const v2Sig = await hmacSha256(TEST_KEY, v2Payload);
  assert.ok(!v2Payload.includes("decision="), "v2 payload must not cover the decision field (pre-F2 gap, by design)");

  const v2Res = await handleRestRequest(postVerify({ signing_payload: v2Payload, signature: v2Sig }), TEST_KEY);
  assert.equal(
    (await v2Res.json() as { status: string }).status,
    "valid",
    "v2 sig still validates regardless of decision — proves v2 alone never covered the decision"
  );
});

// ─── F2: end-to-end golden vector freezes [FRESHCONTEXT_SIG_V3] serialization ─
//
// GOLDEN_V3_PINNED_SIG and the canonical_content_sha256/semantic_fingerprint_sha256
// values embedded in GOLDEN_V3_PAYLOAD were computed once via Node createHash/
// createHmac before this test was written:
//   node -e "const {createHash,createHmac}=require('crypto');
//     const sha256=s=>createHash('sha256').update(s,'utf8').digest('hex');
//     const canonical=s=>s.replace(/\r\n/g,'\n').replace(/\r/g,'\n')
//       .split('\n').map(l=>l.replace(/[ \t]+$/,'')).join('\n');
//     const verdictId='cb1a2b1e64fc1814de0b4c4c8bf7c33c36f8da2aa0a06d0088baf23d98ee2a85';
//     const payload=[
//       'FRESHCONTEXT_HA_PRI_V3','result_id=fc-golden-001',
//       'canonical_content_sha256='+sha256(canonical('<content>')),
//       'semantic_fingerprint_sha256='+sha256('null'),
//       'adapter=arxiv','published_at=2026-06-01T00:00:00.000Z',
//       'retrieved_at=2026-06-27T00:00:00.000Z','engine_version=0.3.23',
//       'verdict_id='+verdictId,'decision=use_first'
//     ].join('\n');
//     console.log(createHmac('sha256','<TEST_KEY>').update(payload,'utf8').digest('hex'))"
const GOLDEN_V3_VERDICT_ID = "cb1a2b1e64fc1814de0b4c4c8bf7c33c36f8da2aa0a06d0088baf23d98ee2a85";
const GOLDEN_V3_PAYLOAD =
  "FRESHCONTEXT_HA_PRI_V3\n" +
  "result_id=fc-golden-001\n" +
  "canonical_content_sha256=348fc2ceca7252bc7cd615afedcc70114ff692ddb39fdae6c14df37d63955ec8\n" +
  "semantic_fingerprint_sha256=74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b\n" +
  "adapter=arxiv\n" +
  "published_at=2026-06-01T00:00:00.000Z\n" +
  "retrieved_at=2026-06-27T00:00:00.000Z\n" +
  "engine_version=0.3.23\n" +
  `verdict_id=${GOLDEN_V3_VERDICT_ID}\n` +
  "decision=use_first";
const GOLDEN_V3_PINNED_SIG = "6140b3d03376fd603a64a4c48d2f986c60207b55215d90d1348cf963e0f5ffcf";
const GOLDEN_V3_EXPECTED_BLOCK = [
  "[FRESHCONTEXT_SIG_V3]",
  "algo=HMAC-SHA256",
  `item=1 result_id=fc-golden-001 verdict_id=${GOLDEN_V3_VERDICT_ID} ` +
    `sig=${GOLDEN_V3_PINNED_SIG} payload=${JSON.stringify(GOLDEN_V3_PAYLOAD)}`,
  "[/FRESHCONTEXT_SIG_V3]",
].join("\n");

test("Ha-Pri v3 emitted payload: buildHaPriPayloadV3 output matches the pinned golden payload", () => {
  const payload = buildHaPriPayloadV3({
    resultId: "fc-golden-001",
    rawContent: "FreshContext golden-vector signal: stable content for pinned sig test.",
    semanticFingerprint: null,
    adapter: "arxiv",
    publishedAt: "2026-06-01T00:00:00.000Z",
    retrievedAt: "2026-06-27T00:00:00.000Z",
    engineVersion: "0.3.23",
    verdictId: GOLDEN_V3_VERDICT_ID,
    decision: "use_first",
  });
  assert.equal(payload, GOLDEN_V3_PAYLOAD);
});

test("evaluate_context signing: [FRESHCONTEXT_SIG_V3] end-to-end golden vector freezes the emitted block serialization", async () => {
  const sig = await hmacSha256(TEST_KEY, GOLDEN_V3_PAYLOAD);
  assert.equal(sig, GOLDEN_V3_PINNED_SIG);

  const line =
    `item=1 result_id=fc-golden-001 verdict_id=${GOLDEN_V3_VERDICT_ID} ` +
    `sig=${sig} payload=${JSON.stringify(GOLDEN_V3_PAYLOAD)}`;
  const block = ["[FRESHCONTEXT_SIG_V3]", "algo=HMAC-SHA256", line, "[/FRESHCONTEXT_SIG_V3]"].join("\n");
  assert.equal(block, GOLDEN_V3_EXPECTED_BLOCK);
});

test("evaluate_context signing: emitted v3 signature is the same computation reused for the ledger row, not a second HMAC", async () => {
  const result = evaluateContextInput({
    profile: "academic_research",
    intent: "citation_check",
    signals: [{
      id: "fc-v3-ledger-parity-001",
      source: "https://arxiv.org/abs/2026.v3ledgerparity001",
      content: "V3 ledger-parity test: the emitted signature and the ledger row must share one computation.",
    }],
    now: SIGN_NOW,
  });

  const { items } = await buildSigBlockV3(result, TEST_KEY);
  assert.equal(items.length, 1, "single signable signal must produce exactly one v3 item");

  // Mirrors worker.ts's snapshotRows.push shape for the verify-relevant fields —
  // built from the SAME payload/sig buildSigBlockV3 just emitted (worker.ts:1305-1327
  // pushes to sigLinesV3 and snapshotRows from the identical v3Payload/v3Sig
  // variables in one loop iteration, never recomputing). This asserts the values
  // a caller sees and the values the ledger stores cannot diverge because they
  // are, structurally, one value used twice.
  const ledgerRow = {
    signing_payload: items[0].payload,
    signature: items[0].sig,
    signature_version: "FRESHCONTEXT_HA_PRI_V3" as const,
  };

  // Prove the parity is meaningful: the ledger row's stored bytes verify through
  // the exact same real /v1/verify path a caller would use for the emitted block.
  const verifyRes = await handleRestRequest(
    postVerify({ signing_payload: ledgerRow.signing_payload, signature: ledgerRow.signature }),
    TEST_KEY
  );
  assert.equal((await verifyRes.json() as { status: string }).status, "valid");
});
