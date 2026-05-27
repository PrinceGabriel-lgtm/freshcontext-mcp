import test from "node:test";
import assert from "node:assert/strict";
import {
  LAMBDA,
  calculateFreshnessScore,
  scoreLabel,
  looksLikeFailedAdapterContent,
  stampFreshness,
  toStructuredJSON,
  formatForLLM,
  calculateContextUtility,
  canonicalizeHaPriContent,
  sha256Hex,
  calculateHaPriV2,
  verifyHaPriV2,
  SIGNAL_CONTRACT_VERSION,
  normalizeSignal,
} from "../src/core/index.js";
import type {
  AdapterResult,
  ContextUtilityResult,
  ExtractOptions,
  FreshContextSignal,
  FreshContextSignalInput,
  FreshContext,
  HaPriV2Input,
  HaPriV2Result,
} from "../src/core/index.js";

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function minutesFrom(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60 * 1000).toISOString();
}

const BASE_HA_PRI_V2_INPUT: HaPriV2Input = {
  resultId: "sr_test_123",
  rawContent: "Show HN: FreshContext\nhttps://example.com/freshcontext\nPublished: 2026-05-24",
  semanticFingerprint: "abc123semantic",
  adapter: "hackernews",
  publishedAt: "2026-05-24T10:00:00.000Z",
  retrievedAt: "2026-05-24T11:00:00.000Z",
  engineVersion: "freshcontext-0.3.17",
};

test("Core exports decay policy constants for current adapters", () => {
  assert.equal(typeof LAMBDA.hackernews, "number");
  assert.equal(typeof LAMBDA.github, "number");
  assert.equal(typeof LAMBDA.finance, "number");
  assert.equal(typeof LAMBDA.changelog, "number");
  assert.equal(typeof LAMBDA.sec_filings, "number");
  assert.equal(typeof LAMBDA.default, "number");
});

test("Core calculateFreshnessScore handles valid, missing, and invalid dates", () => {
  const retrievedAt = new Date().toISOString();
  const score = calculateFreshnessScore(hoursAgo(2), retrievedAt, "hackernews");

  assert.equal(typeof score, "number");
  assert.ok(score !== null && score >= 0 && score <= 100);
  assert.equal(calculateFreshnessScore(null, retrievedAt, "hackernews"), null);
  assert.equal(calculateFreshnessScore("not-a-date", retrievedAt, "hackernews"), null);
});

test("Core calculateFreshnessScore tolerates clock skew but rejects future timestamps", () => {
  const retrievedAt = "2026-05-24T12:00:00.000Z";
  const withinClockSkew = minutesFrom(retrievedAt, 5);
  const beyondClockSkew = minutesFrom(retrievedAt, 6);

  assert.equal(calculateFreshnessScore(withinClockSkew, retrievedAt, "hackernews"), 100);
  assert.equal(calculateFreshnessScore(beyondClockSkew, retrievedAt, "hackernews"), null);
  assert.equal(calculateFreshnessScore(minutesFrom(retrievedAt, 24 * 60), retrievedAt, "hackernews"), null);
});

test("Core scoreLabel preserves score bands", () => {
  assert.equal(scoreLabel(null), "unknown");
  assert.equal(scoreLabel(95), "current");
  assert.equal(scoreLabel(75), "reliable");
  assert.equal(scoreLabel(55), "verify before acting");
  assert.equal(scoreLabel(20), "use with caution");
});

test("Core normalizeSignal emits the Signal Contract v1 shape for normal signals", () => {
  const signal: FreshContextSignal = normalizeSignal({
    id: "sig_normal",
    source: "https://example.com/normal",
    source_type: "hackernews",
    title: "Normal signal",
    content: "FreshContext signal contract content",
    published_at: "2026-05-24T10:00:00.000Z",
    retrieved_at: "2026-05-24T11:00:00.000Z",
    semantic_score: 0.82,
    date_confidence: "high",
    status: "success",
    metadata: { topic: "core" },
  });

  assert.equal(signal.contract_version, SIGNAL_CONTRACT_VERSION);
  assert.equal(signal.source_type, "hackernews");
  assert.equal(signal.published_at, "2026-05-24T10:00:00.000Z");
  assert.equal(signal.retrieved_at, "2026-05-24T11:00:00.000Z");
  assert.equal(signal.semantic_score, 0.82);
  assert.equal(signal.date_confidence, "high");
  assert.equal(signal.status, "success");
  assert.deepEqual(signal.metadata, { topic: "core" });
  assert.deepEqual(signal.reasons, []);
});

test("Core normalizeSignal maps content_date alias to published_at", () => {
  const signal = normalizeSignal({
    source: "https://example.com/content-date",
    source_type: "github",
    content_date: "2026-05-24T10:00:00.000Z",
    retrieved_at: "2026-05-24T11:00:00.000Z",
    semantic_score: 0.7,
    freshness_confidence: "medium",
  });

  assert.equal(signal.published_at, "2026-05-24T10:00:00.000Z");
  assert.equal(signal.date_confidence, "medium");
  assert.ok(signal.reasons.some((reason) => reason.includes("content_date alias")));
});

test("Core normalizeSignal clears missing, invalid, and meaningfully future dates", () => {
  const retrievedAt = "2026-05-24T12:00:00.000Z";
  const missing = normalizeSignal({
    source: "https://example.com/missing-date",
    source_type: "blog",
    retrieved_at: retrievedAt,
    semantic_score: 0.7,
  });
  const invalid = normalizeSignal({
    source: "https://example.com/invalid-date",
    source_type: "blog",
    published_at: "not-a-date",
    retrieved_at: retrievedAt,
    semantic_score: 0.7,
  });
  const future = normalizeSignal({
    source: "https://example.com/future-date",
    source_type: "blog",
    published_at: minutesFrom(retrievedAt, 6),
    retrieved_at: retrievedAt,
    semantic_score: 0.7,
    date_confidence: "high",
  });

  assert.equal(missing.published_at, null);
  assert.equal(missing.date_confidence, "unknown");
  assert.equal(invalid.published_at, null);
  assert.equal(invalid.date_confidence, "unknown");
  assert.ok(invalid.reasons.some((reason) => reason.includes("invalid")));
  assert.equal(future.published_at, null);
  assert.equal(future.date_confidence, "unknown");
  assert.ok(future.reasons.some((reason) => reason.includes("future-dated")));
});

test("Core normalizeSignal marks failed content and clamps semantic scores", () => {
  const invalidScore = normalizeSignal({
    source: "https://example.com/invalid-score",
    source_type: "github",
    published_at: "2026-05-24T10:00:00.000Z",
    retrieved_at: "2026-05-24T11:00:00.000Z",
  });
  const oversizedScore = normalizeSignal({
    source: "https://example.com/oversized-score",
    source_type: "github",
    published_at: "2026-05-24T10:00:00.000Z",
    retrieved_at: "2026-05-24T11:00:00.000Z",
    semantic_score: 2,
  });
  const failed = normalizeSignal({
    source: "https://example.com/failed",
    source_type: "github",
    content: "[Error] upstream timeout",
    published_at: "2026-05-24T10:00:00.000Z",
    retrieved_at: "2026-05-24T11:00:00.000Z",
    semantic_score: 0.9,
  });

  assert.equal(invalidScore.semantic_score, 0);
  assert.ok(invalidScore.reasons.some((reason) => reason.includes("semantic_score")));
  assert.equal(oversizedScore.semantic_score, 1);
  assert.equal(failed.status, "failed");
  assert.ok(failed.reasons.some((reason) => reason.includes("failed adapter output")));
});

test("Core normalizeSignal does not mutate caller-owned input", () => {
  const input: FreshContextSignalInput = {
    source: "https://example.com/no-mutation",
    source_type: "hackernews",
    published_at: "2026-05-24T10:00:00.000Z",
    retrieved_at: "2026-05-24T11:00:00.000Z",
    semantic_score: 0.8,
    metadata: { nested: { value: true } },
  };
  const snapshot = JSON.stringify(input);

  normalizeSignal(input);

  assert.equal(JSON.stringify(input), snapshot);
});

test("Core failure guard detects empty, security, timeout, and error-like output", () => {
  assert.equal(looksLikeFailedAdapterContent(""), true);
  assert.equal(looksLikeFailedAdapterContent("[Security] Domain not allowed"), true);
  assert.equal(looksLikeFailedAdapterContent("timeout"), true);
  assert.equal(looksLikeFailedAdapterContent("[Error] upstream timeout"), true);
  assert.equal(looksLikeFailedAdapterContent("Useful retrieved result\nwith real content"), false);
});

test("Core stampFreshness returns a FreshContext-compatible object", () => {
  const result: AdapterResult = {
    raw: "Core API content",
    content_date: hoursAgo(1),
    freshness_confidence: "high",
  };
  const options: ExtractOptions = {
    url: "https://example.com/core-api",
    maxLength: 8000,
  };

  const ctx: FreshContext = stampFreshness(result, options, "hackernews");

  assert.equal(ctx.content, result.raw);
  assert.equal(ctx.source_url, options.url);
  assert.equal(ctx.content_date, result.content_date);
  assert.equal(ctx.freshness_confidence, "high");
  assert.equal(ctx.adapter, "hackernews");
  assert.equal(typeof ctx.retrieved_at, "string");
  assert.equal(typeof ctx.freshness_score, "number");
});

test("Core toStructuredJSON exposes freshness metadata", () => {
  const ctx = stampFreshness({
    raw: "Structured Core content",
    content_date: hoursAgo(1),
    freshness_confidence: "high",
  }, { url: "https://example.com/structured", maxLength: 8000 }, "hackernews");

  const structured = toStructuredJSON(ctx) as {
    freshcontext: {
      source_url: string;
      content_date: string | null;
      retrieved_at: string;
      freshness_confidence: "high" | "medium" | "low";
      freshness_score: number | null;
      adapter: string;
    };
    content: string;
  };

  assert.equal(structured.freshcontext.source_url, ctx.source_url);
  assert.equal(structured.freshcontext.content_date, ctx.content_date);
  assert.equal(structured.freshcontext.retrieved_at, ctx.retrieved_at);
  assert.equal(structured.freshcontext.freshness_confidence, ctx.freshness_confidence);
  assert.equal(structured.freshcontext.freshness_score, ctx.freshness_score);
  assert.equal(structured.freshcontext.adapter, ctx.adapter);
  assert.equal(structured.content, ctx.content);
});

test("Core formatForLLM returns the FreshContext text and JSON envelopes", () => {
  const ctx = stampFreshness({
    raw: "LLM envelope content",
    content_date: hoursAgo(1),
    freshness_confidence: "high",
  }, { url: "https://example.com/llm", maxLength: 8000 }, "hackernews");

  const text = formatForLLM(ctx);

  assert.match(text, /\[FRESHCONTEXT\]/);
  assert.match(text, /Source: https:\/\/example\.com\/llm/);
  assert.match(text, /Published:/);
  assert.match(text, /Retrieved:/);
  assert.match(text, /Confidence: high/);
  assert.match(text, /\[FRESHCONTEXT_JSON\]/);
  assert.match(text, /\[\/FRESHCONTEXT_JSON\]/);
});

test("Core calculateContextUtility is deterministic and exposes DAR factors", () => {
  const first: ContextUtilityResult = calculateContextUtility({
    contextualRelevance: 80,
    lambda: 0.01,
    ageHours: 24,
    dateConfidence: "high",
    status: "success",
  });
  const second = calculateContextUtility({
    contextualRelevance: 80,
    lambda: 0.01,
    ageHours: 24,
    dateConfidence: "high",
    status: "success",
  });

  assert.deepEqual(first, second);
  assert.ok(first.score >= 0 && first.score <= 100);
  assert.equal(first.contextualRelevance, 80);
  assert.equal(first.lambda, 0.01);
  assert.equal(first.ageHours, 24);
  assert.ok(Math.abs(first.decayFactor - Math.exp(-0.01 * 24)) < 1e-12);
  assert.equal(first.dateConfidenceFactor, 1);
  assert.equal(first.statusFactor, 1);
  assert.equal(first.status, "success");
});

test("Core calculateContextUtility decays with time and lambda", () => {
  const base = {
    contextualRelevance: 80,
    dateConfidence: "high" as const,
    status: "success" as const,
  };
  const younger = calculateContextUtility({ ...base, lambda: 0.01, ageHours: 12 });
  const older = calculateContextUtility({ ...base, lambda: 0.01, ageHours: 48 });
  const slower = calculateContextUtility({ ...base, lambda: 0.005, ageHours: 24 });
  const faster = calculateContextUtility({ ...base, lambda: 0.05, ageHours: 24 });

  assert.ok(younger.score > older.score);
  assert.ok(slower.score > faster.score);
});

test("Core calculateContextUtility applies date confidence and status factors", () => {
  const base = {
    contextualRelevance: 80,
    lambda: 0.01,
    ageHours: 24,
  };
  const high = calculateContextUtility({ ...base, dateConfidence: "high", status: "success" });
  const medium = calculateContextUtility({ ...base, dateConfidence: "medium", status: "success" });
  const low = calculateContextUtility({ ...base, dateConfidence: "low", status: "success" });
  const success = calculateContextUtility({ ...base, dateConfidence: "high", status: "success" });
  const partial = calculateContextUtility({ ...base, dateConfidence: "high", status: "partial" });
  const failed = calculateContextUtility({ ...base, dateConfidence: "high", status: "failed" });
  const unknownDate = calculateContextUtility({ ...base, dateConfidence: "unknown", status: "success" });

  assert.ok(medium.score < high.score);
  assert.ok(low.score < medium.score);
  assert.ok(partial.score < success.score);
  assert.equal(failed.score, 0);
  assert.match(failed.reasons.join(" "), /failed/);
  assert.equal(unknownDate.score, 0);
  assert.match(unknownDate.reasons.join(" "), /unknown/);
});

test("Core calculateContextUtility keeps contextual relevance material", () => {
  const freshWeak = calculateContextUtility({
    contextualRelevance: 15,
    lambda: 0.01,
    ageHours: 0,
    dateConfidence: "high",
    status: "success",
  });
  const decayedRelevant = calculateContextUtility({
    contextualRelevance: 90,
    lambda: 0.001,
    ageHours: 24,
    dateConfidence: "high",
    status: "success",
  });

  assert.ok(decayedRelevant.score > freshWeak.score);
});

test("Core calculateContextUtility clamps relevance, age, and lambda safely", () => {
  const tooHigh = calculateContextUtility({
    contextualRelevance: 150,
    lambda: 0,
    ageHours: 0,
    dateConfidence: "high",
    status: "success",
  });
  const tooLow = calculateContextUtility({
    contextualRelevance: -10,
    lambda: 0,
    ageHours: 0,
    dateConfidence: "high",
    status: "success",
  });
  const negativeAge = calculateContextUtility({
    contextualRelevance: 80,
    lambda: 0.01,
    ageHours: -24,
    dateConfidence: "high",
    status: "success",
  });
  const invalidLambda = calculateContextUtility({
    contextualRelevance: 80,
    lambda: Number.NaN,
    ageHours: 24,
    dateConfidence: "high",
    status: "success",
  });

  assert.equal(tooHigh.contextualRelevance, 100);
  assert.equal(tooHigh.score, 100);
  assert.equal(tooLow.contextualRelevance, 0);
  assert.equal(tooLow.score, 0);
  assert.equal(negativeAge.ageHours, 0);
  assert.match(negativeAge.reasons.join(" "), /negative/);
  assert.equal(invalidLambda.lambda, 0);
  assert.match(invalidLambda.reasons.join(" "), /lambda/);
});

test("Core context utility public export is available from src/core/index.ts", () => {
  const utility = calculateContextUtility({
    contextualRelevance: 80,
    lambda: 0.01,
    ageHours: 24,
    dateConfidence: "high",
    status: "success",
  });

  assert.equal(typeof calculateContextUtility, "function");
  assert.equal(typeof utility.score, "number");
  assert.equal(Array.isArray(utility.reasons), true);
});

test("Core Ha-Pri v2 signature is deterministic and exposes signing material", () => {
  const first: HaPriV2Result = calculateHaPriV2(BASE_HA_PRI_V2_INPUT);
  const second = calculateHaPriV2(BASE_HA_PRI_V2_INPUT);

  assert.deepEqual(first, second);
  assert.equal(first.version, "FRESHCONTEXT_HA_PRI_V2");
  assert.equal(first.resultId, BASE_HA_PRI_V2_INPUT.resultId);
  assert.equal(first.adapter, BASE_HA_PRI_V2_INPUT.adapter);
  assert.equal(first.publishedAt, BASE_HA_PRI_V2_INPUT.publishedAt);
  assert.equal(first.retrievedAt, BASE_HA_PRI_V2_INPUT.retrievedAt);
  assert.equal(first.engineVersion, BASE_HA_PRI_V2_INPUT.engineVersion);
  assert.match(first.canonicalContentSha256, /^[a-f0-9]{64}$/);
  assert.match(first.semanticFingerprintSha256, /^[a-f0-9]{64}$/);
  assert.match(first.haPriSigV2, /^[a-f0-9]{64}$/);
  assert.equal(first.haPriSigV2, sha256Hex(first.signingPayload));
});

test("Core Ha-Pri v2 signing payload uses stable field order", () => {
  const result = calculateHaPriV2(BASE_HA_PRI_V2_INPUT);
  const expectedPayload = [
    "FRESHCONTEXT_HA_PRI_V2",
    `result_id=${BASE_HA_PRI_V2_INPUT.resultId}`,
    `canonical_content_sha256=${result.canonicalContentSha256}`,
    `semantic_fingerprint_sha256=${result.semanticFingerprintSha256}`,
    `adapter=${BASE_HA_PRI_V2_INPUT.adapter}`,
    `published_at=${BASE_HA_PRI_V2_INPUT.publishedAt}`,
    `retrieved_at=${BASE_HA_PRI_V2_INPUT.retrievedAt}`,
    `engine_version=${BASE_HA_PRI_V2_INPUT.engineVersion}`,
  ].join("\n");

  assert.equal(result.signingPayload, expectedPayload);
});

test("Core Ha-Pri v2 detects content tampering through content hash and signature", () => {
  const original = calculateHaPriV2(BASE_HA_PRI_V2_INPUT);
  const tampered = calculateHaPriV2({
    ...BASE_HA_PRI_V2_INPUT,
    rawContent: `${BASE_HA_PRI_V2_INPUT.rawContent}\nTampered line`,
  });

  assert.notEqual(tampered.canonicalContentSha256, original.canonicalContentSha256);
  assert.notEqual(tampered.haPriSigV2, original.haPriSigV2);
});

test("Core Ha-Pri v2 binds result ID, engine version, adapter, and timestamps", () => {
  const original = calculateHaPriV2(BASE_HA_PRI_V2_INPUT);
  const changedResultId = calculateHaPriV2({ ...BASE_HA_PRI_V2_INPUT, resultId: "sr_other" });
  const changedEngine = calculateHaPriV2({ ...BASE_HA_PRI_V2_INPUT, engineVersion: "freshcontext-0.3.18" });
  const changedAdapter = calculateHaPriV2({ ...BASE_HA_PRI_V2_INPUT, adapter: "reddit" });
  const changedPublished = calculateHaPriV2({ ...BASE_HA_PRI_V2_INPUT, publishedAt: "2026-05-24T12:00:00.000Z" });
  const changedRetrieved = calculateHaPriV2({ ...BASE_HA_PRI_V2_INPUT, retrievedAt: "2026-05-24T12:00:00.000Z" });

  assert.notEqual(changedResultId.haPriSigV2, original.haPriSigV2);
  assert.notEqual(changedEngine.haPriSigV2, original.haPriSigV2);
  assert.notEqual(changedAdapter.haPriSigV2, original.haPriSigV2);
  assert.notEqual(changedPublished.haPriSigV2, original.haPriSigV2);
  assert.notEqual(changedRetrieved.haPriSigV2, original.haPriSigV2);
});

test("Core Ha-Pri v2 binds semantic fingerprint and handles absent fields explicitly", () => {
  const original = calculateHaPriV2(BASE_HA_PRI_V2_INPUT);
  const changedSemantic = calculateHaPriV2({
    ...BASE_HA_PRI_V2_INPUT,
    semanticFingerprint: "different-semantic-fingerprint",
  });
  const missingFields = calculateHaPriV2({
    ...BASE_HA_PRI_V2_INPUT,
    semanticFingerprint: null,
    publishedAt: null,
    retrievedAt: undefined,
  });

  assert.notEqual(changedSemantic.semanticFingerprintSha256, original.semanticFingerprintSha256);
  assert.notEqual(changedSemantic.haPriSigV2, original.haPriSigV2);
  assert.equal(missingFields.semanticFingerprintSha256, sha256Hex("null"));
  assert.match(missingFields.signingPayload, /published_at=null/);
  assert.match(missingFields.signingPayload, /retrieved_at=null/);
});

test("Core Ha-Pri v2 canonicalizes line endings and trailing whitespace", () => {
  const crlf = "Alpha  \r\nBeta\t\rGamma";
  const lf = "Alpha\nBeta\nGamma";

  assert.equal(canonicalizeHaPriContent(crlf), lf);
  assert.equal(
    calculateHaPriV2({ ...BASE_HA_PRI_V2_INPUT, rawContent: crlf }).canonicalContentSha256,
    calculateHaPriV2({ ...BASE_HA_PRI_V2_INPUT, rawContent: lf }).canonicalContentSha256
  );
});

test("Core Ha-Pri v2 verification returns valid, invalid, and unknown", () => {
  const calculated = calculateHaPriV2(BASE_HA_PRI_V2_INPUT);
  const valid = verifyHaPriV2(BASE_HA_PRI_V2_INPUT, calculated.haPriSigV2);
  const invalid = verifyHaPriV2(
    { ...BASE_HA_PRI_V2_INPUT, rawContent: `${BASE_HA_PRI_V2_INPUT.rawContent}\nchanged` },
    calculated.haPriSigV2
  );
  const unknownNull = verifyHaPriV2(BASE_HA_PRI_V2_INPUT, null);
  const unknownBlank = verifyHaPriV2(BASE_HA_PRI_V2_INPUT, " ");

  assert.equal(valid.status, "valid");
  assert.equal(valid.expected, calculated.haPriSigV2);
  assert.equal(valid.actual, calculated.haPriSigV2);
  assert.deepEqual(valid.reasons, []);

  assert.equal(invalid.status, "invalid");
  assert.equal(invalid.actual, calculated.haPriSigV2);
  assert.match(invalid.reasons.join(" "), /did not match/);

  assert.equal(unknownNull.status, "unknown");
  assert.equal(unknownNull.expected, null);
  assert.equal(unknownNull.actual, null);
  assert.match(unknownNull.reasons.join(" "), /missing/);

  assert.equal(unknownBlank.status, "unknown");
  assert.equal(unknownBlank.actual, " ");
});

test("Core Ha-Pri v2 public exports are available from src/core/index.ts", () => {
  const result = calculateHaPriV2(BASE_HA_PRI_V2_INPUT);
  const verified = verifyHaPriV2(BASE_HA_PRI_V2_INPUT, result.haPriSigV2);

  assert.equal(typeof canonicalizeHaPriContent, "function");
  assert.equal(typeof sha256Hex, "function");
  assert.equal(typeof calculateHaPriV2, "function");
  assert.equal(typeof verifyHaPriV2, "function");
  assert.equal(verified.status, "valid");
});
