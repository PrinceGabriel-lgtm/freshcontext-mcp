import test from "node:test";
import assert from "node:assert/strict";
import {
  toReadableContextResult,
  type ContextDecision,
  type ContextDecisionResult,
  type CoreSignalEvaluationResult,
} from "../src/core/index.js";

const EXPECTED_LABELS: Record<ContextDecision, string> = {
  use_first: "Use first",
  cite_as_primary: "Primary source",
  cite_as_supporting: "Supporting source",
  use_as_background: "Background only",
  needs_verification: "Needs verification",
  needs_refresh: "Needs refresh",
  watch_only: "Watch only",
  exclude: "Excluded",
};

function evaluation(overrides: Partial<CoreSignalEvaluationResult> = {}): CoreSignalEvaluationResult {
  return {
    signal: {
      contract_version: "freshcontext.signal.v1",
      source: "https://example.com/source",
      source_type: "arxiv",
      title: "Example source",
      content: "Example context.",
      published_at: "2026-06-01T00:00:00.000Z",
      retrieved_at: "2026-06-09T00:00:00.000Z",
      semantic_score: 0.9,
      date_confidence: "high",
      status: "success",
      metadata: {},
      reasons: [],
    },
    freshness_score: 90,
    utility: {
      score: 80,
      contextualRelevance: 90,
      decayFactor: 0.9,
      dateConfidenceFactor: 1,
      statusFactor: 1,
      lambda: 0.01,
      ageHours: 12,
      status: "success",
      reasons: [],
    },
    ranked: {
      source: "https://example.com/source",
      source_type: "arxiv",
      title: "Example source",
      content: "Example context.",
      published_at: "2026-06-01T00:00:00.000Z",
      retrieved_at: "2026-06-09T00:00:00.000Z",
      semantic_score: 0.9,
      date_confidence: "high",
      status: "success",
      metadata: {},
      freshness_score: 90,
      final_score: 0.9,
      confidence: "high",
      reason: "Strong semantic match and current freshness for arxiv.",
    },
    explanation: "Strong semantic match and current freshness for arxiv.",
    reasons: [],
    ...overrides,
  };
}

function decision(decision: ContextDecision, reasons: string[] = []): ContextDecisionResult {
  return {
    decision,
    label: decision,
    meaning: "Existing machine meaning.",
    action: "Existing machine action.",
    reasons,
    warnings: ["FreshContext does not certify truth."],
  };
}

test("toReadableContextResult maps every Core decision to the expected reader label", () => {
  for (const [machineDecision, expectedLabel] of Object.entries(EXPECTED_LABELS) as [ContextDecision, string][]) {
    const readable = toReadableContextResult(evaluation(), decision(machineDecision));
    assert.equal(readable.label, expectedLabel);
    assert.equal(typeof readable.summary, "string");
    assert.equal(typeof readable.action, "string");
  }
});

test("readable label differs from machine label where the reader contract requires it", () => {
  const readable = toReadableContextResult(evaluation(), {
    ...decision("cite_as_primary"),
    label: "Cite as primary",
  });

  assert.equal(readable.label, "Primary source");
  assert.notEqual(readable.label, "Cite as primary");
});

test("readable output includes summary, capped why, action, and warnings", () => {
  const reasons = [
    "reason 1",
    "reason 2",
    "reason 3",
    "reason 4",
    "reason 5",
    "reason 6",
    "reason 7",
  ];

  const readable = toReadableContextResult(evaluation(), decision("use_first", reasons));

  assert.equal(readable.label, "Use first");
  assert.match(readable.summary, /strong enough/i);
  assert.equal(readable.why.length, 5);
  assert.deepEqual(readable.why, reasons.slice(0, 5));
  assert.match(readable.action, /selected context/i);
  assert.deepEqual(readable.warnings, ["FreshContext does not certify truth."]);
});

test("utility reasons can remain visible in readable why without determining the label", () => {
  const utilityReason = "timestamp confidence is medium; utility reduced";
  const readable = toReadableContextResult(
    evaluation(),
    decision("cite_as_primary", [
      "Strong semantic match and current freshness for arxiv.",
      utilityReason,
    ])
  );

  assert.equal(readable.label, "Primary source");
  assert.ok(readable.why.includes(utilityReason));
});
