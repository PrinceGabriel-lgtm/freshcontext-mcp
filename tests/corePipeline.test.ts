import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateSignal,
  evaluateSignals,
} from "../src/core/index.js";
import type {
  CoreSignalEvaluationOptions,
  CoreSignalEvaluationResult,
  FreshContextSignalInput,
} from "../src/core/index.js";

const NOW = "2026-05-24T13:00:00.000Z";

function baseInput(overrides: Partial<FreshContextSignalInput> = {}): FreshContextSignalInput {
  return {
    id: "sig_test",
    source: "https://example.com/signal",
    source_type: "hackernews",
    title: "FreshContext signal",
    content: "FreshContext pipeline content",
    published_at: "2026-05-24T12:00:00.000Z",
    retrieved_at: NOW,
    semantic_score: 0.9,
    date_confidence: "high",
    status: "success",
    metadata: { topic: "core" },
    ...overrides,
  };
}

test("evaluateSignal returns normalized signal, freshness, utility, rank, and explanation", () => {
  const result = evaluateSignal(baseInput(), { now: NOW });

  assert.equal(result.signal.contract_version, "freshcontext.signal.v1");
  assert.equal(result.signal.published_at, "2026-05-24T12:00:00.000Z");
  assert.equal(result.signal.retrieved_at, NOW);
  assert.equal(typeof result.freshness_score, "number");
  assert.ok(result.utility.score > 0);
  assert.equal(result.ranked.freshness_score, result.freshness_score);
  assert.equal(result.explanation, result.ranked.reason);
  assert.deepEqual(result.signal.metadata, { topic: "core" });
});

test("evaluateSignal gives missing timestamps unknown date confidence and zero utility", () => {
  const result = evaluateSignal(baseInput({
    published_at: null,
    date_confidence: "high",
  }), { now: NOW });

  assert.equal(result.signal.published_at, null);
  assert.equal(result.signal.date_confidence, "unknown");
  assert.equal(result.freshness_score, null);
  assert.equal(result.utility.score, 0);
  assert.equal(result.ranked.freshness_score, null);
  assert.match(result.reasons.join(" "), /unknown/);
});

test("evaluateSignal prevents failed content from ranking as high-confidence fresh context", () => {
  const result = evaluateSignal(baseInput({
    content: "[Error] upstream timeout",
    semantic_score: 0.95,
  }), { now: NOW });

  assert.equal(result.signal.status, "failed");
  assert.equal(result.freshness_score, null);
  assert.equal(result.utility.score, 0);
  assert.equal(result.ranked.confidence, "low");
  assert.equal(result.ranked.freshness_score, null);
});

test("evaluateSignal clears future timestamps before scoring", () => {
  const result = evaluateSignal(baseInput({
    published_at: "2026-05-24T13:06:00.000Z",
    date_confidence: "high",
  }), { now: NOW });

  assert.equal(result.signal.published_at, null);
  assert.equal(result.signal.date_confidence, "unknown");
  assert.equal(result.freshness_score, null);
  assert.equal(result.utility.score, 0);
  assert.ok(result.reasons.some((reason) => reason.includes("future-dated")));
});

test("evaluateSignal can emit a FreshContext-compatible envelope without host code", () => {
  const result = evaluateSignal(baseInput(), {
    now: NOW,
    includeEnvelope: true,
    envelopeMaxLength: 12,
    envelopeFormat: { unknownDateText: "Published: unknown" },
  });

  assert.ok(result.envelope);
  assert.equal(result.envelope.context.content, "FreshContext");
  assert.equal(result.envelope.context.source_url, "https://example.com/signal");
  assert.equal(result.envelope.context.content_date, "2026-05-24T12:00:00.000Z");
  assert.match(result.envelope.text, /\[FRESHCONTEXT\]/);
  assert.match(result.envelope.text, /\[FRESHCONTEXT_JSON\]/);
  assert.deepEqual(result.envelope.structured, {
    freshcontext: {
      source_url: result.envelope.context.source_url,
      content_date: result.envelope.context.content_date,
      retrieved_at: result.envelope.context.retrieved_at,
      freshness_confidence: result.envelope.context.freshness_confidence,
      freshness_score: result.envelope.context.freshness_score,
      adapter: result.envelope.context.adapter,
    },
    content: result.envelope.context.content,
  });
});

test("evaluateSignal emits optional Ha-Pri v2 provenance when required material is present", () => {
  const result = evaluateSignal(baseInput(), {
    now: NOW,
    includeProvenance: true,
    provenance: {
      resultId: "sr_pipeline",
      semanticFingerprint: "pipeline-fingerprint",
      engineVersion: "freshcontext-0.3.17",
    },
  });

  assert.ok(result.provenance);
  assert.equal(result.provenance.resultId, "sr_pipeline");
  assert.equal(result.provenance.adapter, "hackernews");
  assert.equal(result.provenance.publishedAt, "2026-05-24T12:00:00.000Z");
  assert.equal(result.provenance.retrievedAt, NOW);
  assert.match(result.provenance.haPriSigV2, /^[a-f0-9]{64}$/);
});

test("evaluateSignal omits provenance and records reasons when required material is missing", () => {
  const result = evaluateSignal(baseInput({ id: undefined }), {
    now: NOW,
    includeProvenance: true,
    provenance: {
      engineVersion: "freshcontext-0.3.17",
    },
  });

  assert.equal(result.provenance, undefined);
  assert.ok(result.reasons.some((reason) => reason.includes("resultId")));
});

test("evaluateSignals sorts by ranked score and preserves stable tie ordering", () => {
  const first = baseInput({
    id: "first",
    source: "https://example.com/first",
    semantic_score: 0.7,
  });
  const second = baseInput({
    id: "second",
    source: "https://example.com/second",
    semantic_score: 0.95,
  });
  const tieA = baseInput({
    id: "tie-a",
    source: "https://example.com/tie-a",
    semantic_score: 0.8,
  });
  const tieB = baseInput({
    id: "tie-b",
    source: "https://example.com/tie-b",
    semantic_score: 0.8,
  });

  const ranked = evaluateSignals([first, second, tieA, tieB], { now: NOW });

  assert.equal(ranked[0].signal.id, "second");
  assert.equal(ranked[1].signal.id, "tie-a");
  assert.equal(ranked[2].signal.id, "tie-b");
  assert.equal(ranked[3].signal.id, "first");
});

test("evaluateSignals sorting follows ranked final_score, not utility sidecar score", () => {
  const highRankLowUtility = baseInput({
    id: "high-rank-low-utility",
    source: "https://example.com/high-rank-low-utility",
    semantic_score: 0.95,
    status: "stale",
  });
  const lowerRankHighUtility = baseInput({
    id: "lower-rank-high-utility",
    source: "https://example.com/lower-rank-high-utility",
    semantic_score: 0.7,
    status: "success",
  });

  const evaluated = evaluateSignals([lowerRankHighUtility, highRankLowUtility], { now: NOW });
  const highRank = evaluated.find((item) => item.signal.id === "high-rank-low-utility");
  const lowerRank = evaluated.find((item) => item.signal.id === "lower-rank-high-utility");

  assert.ok(highRank);
  assert.ok(lowerRank);
  assert.ok(highRank.ranked.final_score > lowerRank.ranked.final_score);
  assert.ok(highRank.utility.score < lowerRank.utility.score);
  assert.equal(evaluated[0].signal.id, "high-rank-low-utility");
  assert.equal(evaluated[1].signal.id, "lower-rank-high-utility");
  assert.equal(typeof highRank.utility.score, "number");
  assert.equal(typeof lowerRank.utility.score, "number");
});

test("evaluateSignal does not mutate caller-owned inputs", () => {
  const input = baseInput({ metadata: { nested: { value: 1 } } });
  const before = JSON.stringify(input);

  const result: CoreSignalEvaluationResult = evaluateSignal(input, { now: NOW });

  assert.equal(JSON.stringify(input), before);
  assert.notEqual(result.signal.metadata, input.metadata);
});

test("evaluateSignal public option type is usable by callers", () => {
  const options: CoreSignalEvaluationOptions = {
    now: NOW,
    includeEnvelope: true,
    includeProvenance: true,
    provenance: {
      resultId: "sr_typed",
      engineVersion: "freshcontext-0.3.17",
    },
  };

  const result = evaluateSignal(baseInput(), options);

  assert.ok(result.envelope);
  assert.ok(result.provenance);
});
