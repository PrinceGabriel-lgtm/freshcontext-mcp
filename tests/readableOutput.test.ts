import test from "node:test";
import assert from "node:assert/strict";
import {
  toReadableContextResult,
  type ContextDecision,
  type ContextDecisionResult,
  type CoreSignalEvaluationResult,
  type HumanReadableContextResult,
  type ProvenanceReadinessState,
} from "../src/core/index.js";

const SAFE_HANDOFF_REASON = "Decision and complete provenance support agent handoff.";
const UNSAFE_DECISION_REASON = "Decision does not support agent handoff.";
const UNSAFE_PROVENANCE_REASON = "Provenance is not complete enough for agent handoff.";
const SAFE_HANDOFF_DECISIONS: ContextDecision[] = [
  "use_first",
  "cite_as_primary",
  "cite_as_supporting",
  "use_as_background",
];
const UNSAFE_HANDOFF_DECISIONS: ContextDecision[] = [
  "needs_verification",
  "needs_refresh",
  "watch_only",
  "exclude",
];
const INCOMPLETE_HANDOFF_PROVENANCE: ProvenanceReadinessState[] = [
  "partial",
  "incomplete",
  "unknown",
  "derived",
];

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

function provenanceReadiness(
  overrides: Partial<CoreSignalEvaluationResult["provenance_readiness"]> = {}
): CoreSignalEvaluationResult["provenance_readiness"] {
  const base: CoreSignalEvaluationResult["provenance_readiness"] = {
    state: "complete",
    source_identity: {
      source: "https://example.com/source",
      source_type: "arxiv",
      result_id: "https://example.com/source",
      completeness: "complete",
    },
    source_type: "arxiv",
    published_at: "2026-06-01T00:00:00.000Z",
    retrieved_at: "2026-06-09T00:00:00.000Z",
    timing_confidence: "high",
    timing_completeness: "complete",
    canonical_content_sha256: "0".repeat(64),
    semantic_fingerprint_sha256: null,
    ha_pri_v2: null,
    warnings: [],
    reasons: ["semantic fingerprint was not provided"],
  };

  return {
    ...base,
    ...overrides,
    source_identity: overrides.source_identity
      ? { ...base.source_identity, ...overrides.source_identity }
      : base.source_identity,
  };
}

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
    provenance_readiness: provenanceReadiness(),
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

function readableWithoutHandoff(readable: HumanReadableContextResult) {
  return {
    label: readable.label,
    summary: readable.summary,
    why: readable.why,
    action: readable.action,
    warnings: readable.warnings,
  };
}

test("toReadableContextResult maps every Core decision to the expected reader label", () => {
  for (const [machineDecision, expectedLabel] of Object.entries(EXPECTED_LABELS) as [ContextDecision, string][]) {
    const readable = toReadableContextResult(evaluation(), decision(machineDecision));
    assert.equal(readable.label, expectedLabel);
    assert.equal(typeof readable.summary, "string");
    assert.equal(typeof readable.action, "string");
    assert.equal(typeof readable.handoff.safe_for_agent_handoff, "boolean");
    assert.equal(typeof readable.handoff.reason, "string");
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
  assert.deepEqual(readable.handoff, {
    safe_for_agent_handoff: true,
    reason: SAFE_HANDOFF_REASON,
  });
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

test("readable handoff allows safe decisions with complete provenance", () => {
  for (const machineDecision of SAFE_HANDOFF_DECISIONS) {
    const readable = toReadableContextResult(evaluation(), decision(machineDecision));
    assert.deepEqual(readable.handoff, {
      safe_for_agent_handoff: true,
      reason: SAFE_HANDOFF_REASON,
    });
  }
});

test("readable handoff blocks safe decisions when provenance readiness is not complete", () => {
  for (const readinessState of INCOMPLETE_HANDOFF_PROVENANCE) {
    const readable = toReadableContextResult(
      evaluation({
        provenance_readiness: provenanceReadiness({ state: readinessState }),
      }),
      decision("cite_as_primary")
    );

    assert.deepEqual(readable.handoff, {
      safe_for_agent_handoff: false,
      reason: UNSAFE_PROVENANCE_REASON,
    });
  }
});

test("readable handoff blocks unsafe decisions", () => {
  for (const machineDecision of UNSAFE_HANDOFF_DECISIONS) {
    const readable = toReadableContextResult(evaluation(), decision(machineDecision));
    assert.deepEqual(readable.handoff, {
      safe_for_agent_handoff: false,
      reason: UNSAFE_DECISION_REASON,
    });
  }
});

test("provenance readiness changes do not change non-handoff readable output", () => {
  const baseEvaluation = evaluation();
  const uncertainReadinessEvaluation = evaluation({
    provenance_readiness: provenanceReadiness({
      state: "derived",
      warnings: ["context appears copied, local, secondary, or derived; preserve the upstream source chain"],
      reasons: ["provenance readiness was forced derived for readable-output regression coverage"],
    }),
  });
  const contextDecision = decision("cite_as_primary", [
    "Strong semantic match and current freshness for arxiv.",
  ]);
  const completeReadable = toReadableContextResult(baseEvaluation, contextDecision);
  const derivedReadable = toReadableContextResult(uncertainReadinessEvaluation, contextDecision);

  assert.deepEqual(readableWithoutHandoff(derivedReadable), readableWithoutHandoff(completeReadable));
  assert.deepEqual(completeReadable.handoff, {
    safe_for_agent_handoff: true,
    reason: SAFE_HANDOFF_REASON,
  });
  assert.deepEqual(derivedReadable.handoff, {
    safe_for_agent_handoff: false,
    reason: UNSAFE_PROVENANCE_REASON,
  });
});
