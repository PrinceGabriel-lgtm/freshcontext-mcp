import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateSignal,
  evaluateSignals,
  interpretEvaluation,
  toReadableContextResult,
} from "../src/core/index.js";
import type {
  ContextDecisionOptions,
  CoreSignalEvaluationOptions,
  CoreSignalEvaluationResult,
  FreshContextSignalInput,
  HumanReadableContextResult,
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

function stableMetrics(result: CoreSignalEvaluationResult) {
  return {
    freshness_score: result.freshness_score,
    utility_score: result.utility.score,
    utility_reasons: result.utility.reasons,
    rank_score: result.ranked.final_score,
    rank_confidence: result.ranked.confidence,
    explanation: result.explanation,
  };
}

function readableWithoutHandoff(readable: HumanReadableContextResult) {
  return {
    label: readable.label,
    summary: readable.summary,
    why: readable.why,
    action: readable.action,
    warnings: readable.warnings,
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
      staleness: result.envelope.context.staleness,
      revalidate_after: result.envelope.context.revalidate_after,
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

test("failed or low-confidence fresh context cannot win merely by being fresh", () => {
  const healthyCurrent = baseInput({
    id: "healthy-current",
    source: "https://example.com/healthy-current",
    semantic_score: 0.82,
    published_at: "2026-05-24T12:00:00.000Z",
  });
  const failedFresh = baseInput({
    id: "failed-fresh",
    source: "https://example.com/failed-fresh",
    content: "[ERROR] upstream timeout for fresh-looking context",
    semantic_score: 1,
    published_at: "2026-05-24T12:00:00.000Z",
  });
  const weakFresh = baseInput({
    id: "weak-fresh",
    source: "https://example.com/weak-fresh",
    semantic_score: 0.05,
    published_at: "2026-05-24T12:00:00.000Z",
  });

  const evaluations = evaluateSignals([failedFresh, weakFresh, healthyCurrent], { now: NOW });
  const failed = evaluations.find((evaluation) => evaluation.signal.id === "failed-fresh");
  const healthy = evaluations.find((evaluation) => evaluation.signal.id === "healthy-current");

  assert.equal(evaluations[0].signal.id, "healthy-current");
  assert.ok(failed);
  assert.ok(healthy);
  assert.equal(failed.signal.status, "failed");
  assert.equal(failed.ranked.confidence, "low");
  assert.equal(failed.freshness_score, null);
  assert.ok(failed.ranked.final_score < healthy.ranked.final_score);
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

test("provenance material is additive to scoring, decisions, and readable output", () => {
  const input = baseInput({ id: "sig_provenance_additive" });
  const withoutProvenance = evaluateSignal(input, { now: NOW });
  const withProvenance = evaluateSignal(input, {
    now: NOW,
    includeProvenance: true,
    provenance: {
      resultId: "sig_provenance_additive",
      semanticFingerprint: "pipeline-additive-fingerprint",
      engineVersion: "freshcontext-0.3.20",
    },
  });
  // Pin now so back-to-back decisions share the same evaluated_at — without
  // this the Pass 21 time fields would differ by sub-ms wall-clock advance and
  // break the deepEqual that asserts provenance is additive.
  const decisionOptions: ContextDecisionOptions = {
    sourceProfile: "official_docs",
    intentProfile: "developer_adoption",
    now: NOW,
  };
  const withoutDecision = interpretEvaluation(withoutProvenance, decisionOptions);
  const withDecision = interpretEvaluation(withProvenance, decisionOptions);

  assert.equal(withoutProvenance.provenance, undefined);
  assert.ok(withProvenance.provenance);
  assert.deepEqual(stableMetrics(withProvenance), stableMetrics(withoutProvenance));
  assert.deepEqual(withDecision, withoutDecision);
  assert.deepEqual(
    readableWithoutHandoff(toReadableContextResult(withProvenance, withDecision)),
    readableWithoutHandoff(toReadableContextResult(withoutProvenance, withoutDecision))
  );
});

test("provenance readiness states do not affect scoring, ranking order, or decisions", () => {
  const variants: Array<{
    id: string;
    expectedState: CoreSignalEvaluationResult["provenance_readiness"]["state"];
    input: Partial<FreshContextSignalInput>;
  }> = [
    {
      id: "complete-readiness",
      expectedState: "complete",
      input: { source: "https://example.com/complete-readiness" },
    },
    {
      id: "partial-readiness",
      expectedState: "partial",
      input: { source: "abc" },
    },
    {
      id: "incomplete-readiness",
      expectedState: "incomplete",
      input: { source: "" },
    },
    {
      id: "unknown-readiness",
      expectedState: "unknown",
      input: { source: "unknown" },
    },
    {
      id: "derived-readiness",
      expectedState: "derived",
      input: {
        source: "https://example.com/derived-readiness",
        metadata: { is_derived: true },
      },
    },
  ];
  const inputs = variants.map((variant) => baseInput({
    id: variant.id,
    source_type: "official_docs",
    ...variant.input,
  }));
  const evaluations = inputs.map((input) => evaluateSignal(input, { now: NOW }));
  const baseline = stableMetrics(evaluations[0]);
  const decisionOptions: ContextDecisionOptions = {
    sourceProfile: "official_docs",
    intentProfile: "developer_adoption",
  };
  const baselineDecision = interpretEvaluation(evaluations[0], decisionOptions).decision;

  assert.deepEqual(
    evaluations.map((evaluation) => evaluation.provenance_readiness.state),
    variants.map((variant) => variant.expectedState)
  );
  for (const evaluation of evaluations) {
    assert.deepEqual(stableMetrics(evaluation), baseline);
    assert.equal(interpretEvaluation(evaluation, decisionOptions).decision, baselineDecision);
  }

  const sorted = evaluateSignals(inputs, { now: NOW });
  assert.deepEqual(sorted.map((evaluation) => evaluation.signal.id), variants.map((variant) => variant.id));
});

test("readable handoff derivation does not affect scoring, ranking, or decisions", () => {
  const inputs = [
    baseInput({
      id: "handoff-complete",
      source_type: "official_docs",
      source: "https://example.com/handoff-complete",
      semantic_score: 0.92,
    }),
    baseInput({
      id: "handoff-derived",
      source_type: "official_docs",
      source: "https://example.com/handoff-derived",
      semantic_score: 0.92,
      metadata: { is_derived: true },
    }),
    baseInput({
      id: "handoff-unknown",
      source_type: "official_docs",
      source: "unknown",
      semantic_score: 0.92,
    }),
  ];
  const options: ContextDecisionOptions = {
    sourceProfile: "official_docs",
    intentProfile: "developer_adoption",
  };
  const evaluations = evaluateSignals(inputs, { now: NOW });
  const decisions = evaluations.map((evaluation) => interpretEvaluation(evaluation, options));
  const before = evaluations.map((evaluation, index) => ({
    id: evaluation.signal.id,
    metrics: stableMetrics(evaluation),
    readiness: evaluation.provenance_readiness.state,
    decision: decisions[index].decision,
  }));
  const readables = evaluations.map((evaluation, index) => toReadableContextResult(evaluation, decisions[index]));
  const after = evaluations.map((evaluation, index) => ({
    id: evaluation.signal.id,
    metrics: stableMetrics(evaluation),
    readiness: evaluation.provenance_readiness.state,
    decision: interpretEvaluation(evaluation, options).decision,
  }));
  const rerun = evaluateSignals(inputs, { now: NOW });

  assert.deepEqual(after, before);
  assert.deepEqual(
    rerun.map((evaluation) => evaluation.signal.id),
    evaluations.map((evaluation) => evaluation.signal.id)
  );
  assert.equal(readables.some((readable) => readable.handoff.safe_for_agent_handoff), true);
  assert.equal(readables.some((readable) => !readable.handoff.safe_for_agent_handoff), true);
});
