import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateSignal,
  interpretEvaluation,
  interpretEvaluations,
  toReadableContextResult,
  computeVerdictId,
  getSourceProfile,
} from "../src/core/index.js";
import type {
  ContextDecisionOptions,
  ContextDecisionResult,
  CoreSignalEvaluationResult,
  FreshContextSignalInput,
} from "../src/core/index.js";

const NOW = "2026-05-24T13:00:00.000Z";

function baseInput(overrides: Partial<FreshContextSignalInput> = {}): FreshContextSignalInput {
  return {
    source: "https://example.com/source",
    source_type: "arxiv",
    title: "Decision layer source",
    content: "Relevant FreshContext decision helper source content.",
    published_at: "2026-05-24T12:00:00.000Z",
    retrieved_at: NOW,
    semantic_score: 0.9,
    date_confidence: "high",
    status: "success",
    ...overrides,
  };
}

function evaluated(
  overrides: Partial<FreshContextSignalInput>,
  options: ContextDecisionOptions
): { evaluation: CoreSignalEvaluationResult; decision: ContextDecisionResult } {
  const evaluation = evaluateSignal(baseInput(overrides), { now: NOW });
  return {
    evaluation,
    decision: interpretEvaluation(evaluation, options),
  };
}

test("failed evaluation becomes exclude", () => {
  const { decision } = evaluated({
    content: "[ERROR] upstream timeout while retrieving metadata",
    semantic_score: 0.95,
  }, {
    sourceProfile: "academic_research",
    intentProfile: "citation_check",
  });

  assert.equal(decision.decision, "exclude");
  assert.match(decision.meaning, /failed|unsafe|weak/i);
  assert.match(decision.action, /Keep it out/i);
});

test("high-quality academic citation check becomes cite_as_primary", () => {
  const { decision } = evaluated({
    source: "https://arxiv.org/abs/2605.12345",
    source_type: "arxiv",
    semantic_score: 0.94,
    published_at: "2026-05-20T09:00:00.000Z",
  }, {
    sourceProfile: "academic_research",
    intentProfile: "citation_check",
  });

  assert.equal(decision.decision, "cite_as_primary");
  assert.match(decision.action, /primary citation/i);
});

test("utility score does not control decision labels", () => {
  const evaluation = evaluateSignal(baseInput({
    source: "https://arxiv.org/abs/2605.12345",
    source_type: "arxiv",
    semantic_score: 0.94,
    published_at: "2026-05-20T09:00:00.000Z",
  }), { now: NOW });
  const lowUtilityEvaluation: CoreSignalEvaluationResult = {
    ...evaluation,
    utility: {
      ...evaluation.utility,
      score: 0,
      reasons: ["utility was forced low for decision-boundary regression coverage"],
    },
  };

  const normalDecision = interpretEvaluation(evaluation, {
    sourceProfile: "academic_research",
    intentProfile: "citation_check",
    now: NOW,
  });
  const lowUtilityDecision = interpretEvaluation(lowUtilityEvaluation, {
    sourceProfile: "academic_research",
    intentProfile: "citation_check",
    now: NOW,
  });

  assert.equal(normalDecision.decision, "cite_as_primary");
  assert.equal(lowUtilityDecision.decision, "cite_as_primary");
});

test("provenance readiness does not control decision labels", () => {
  const evaluation = evaluateSignal(baseInput({
    source: "https://arxiv.org/abs/2605.12345",
    source_type: "arxiv",
    semantic_score: 0.94,
    published_at: "2026-05-20T09:00:00.000Z",
  }), { now: NOW });
  const uncertainReadinessEvaluation: CoreSignalEvaluationResult = {
    ...evaluation,
    provenance_readiness: {
      ...evaluation.provenance_readiness,
      state: "unknown",
      source_identity: {
        ...evaluation.provenance_readiness.source_identity,
        completeness: "unusable",
      },
      warnings: ["provenance readiness was forced uncertain for decision-boundary regression coverage"],
      reasons: ["provenance readiness must remain a sidecar until an explicit policy pass changes it"],
    },
  };

  const normalDecision = interpretEvaluation(evaluation, {
    sourceProfile: "academic_research",
    intentProfile: "citation_check",
    now: NOW,
  });
  const uncertainReadinessDecision = interpretEvaluation(uncertainReadinessEvaluation, {
    sourceProfile: "academic_research",
    intentProfile: "citation_check",
    now: NOW,
  });

  assert.deepEqual(uncertainReadinessDecision, normalDecision);
  assert.equal(uncertainReadinessDecision.decision, "cite_as_primary");
});

test("handoff safety does not control decision-label policy", () => {
  const evaluation = evaluateSignal(baseInput({
    source: "https://arxiv.org/abs/2605.12345",
    source_type: "arxiv",
    semantic_score: 0.94,
    published_at: "2026-05-20T09:00:00.000Z",
  }), { now: NOW });
  const uncertainReadinessEvaluation: CoreSignalEvaluationResult = {
    ...evaluation,
    provenance_readiness: {
      ...evaluation.provenance_readiness,
      state: "derived",
      warnings: ["provenance readiness was forced derived for handoff-policy regression coverage"],
      reasons: ["handoff safety must remain derived from the decision, not a decision input"],
    },
  };
  const options: ContextDecisionOptions = {
    sourceProfile: "academic_research",
    intentProfile: "citation_check",
    now: NOW,
  };

  const decision = interpretEvaluation(uncertainReadinessEvaluation, options);
  const readable = toReadableContextResult(uncertainReadinessEvaluation, decision);
  const decisionAfterReadable = interpretEvaluation(uncertainReadinessEvaluation, options);

  assert.equal(decision.decision, "cite_as_primary");
  assert.equal(readable.handoff.safe_for_agent_handoff, false);
  assert.deepEqual(decisionAfterReadable, decision);
});

test("high utility does not promote low-ranked signals", () => {
  const evaluation = evaluateSignal(baseInput({
    source: "https://news.ycombinator.com/item?id=1",
    source_type: "hackernews",
    semantic_score: 0.05,
    published_at: "2026-05-24T12:00:00.000Z",
  }), { now: NOW });
  const highUtilityEvaluation: CoreSignalEvaluationResult = {
    ...evaluation,
    utility: {
      ...evaluation.utility,
      score: 100,
      reasons: ["utility was forced high for decision-boundary regression coverage"],
    },
  };

  const decision = interpretEvaluation(highUtilityEvaluation, {
    sourceProfile: "social_pulse",
    intentProfile: "developer_adoption",
  });

  assert.ok(evaluation.ranked.final_score < 0.35);
  assert.equal(decision.decision, "watch_only");
});

test("utility reasons remain visible without controlling decisions", () => {
  const evaluation = evaluateSignal(baseInput({
    source: "https://research.example.org/context-notes",
    source_type: "google_scholar",
    semantic_score: 0.62,
    published_at: null,
    date_confidence: "unknown",
  }), { now: NOW });

  const decision = interpretEvaluation(evaluation, {
    sourceProfile: "academic_research",
    intentProfile: "student_research",
  });

  assert.equal(decision.decision, "needs_verification");
  assert.match(decision.reasons.join(" "), /timestamp confidence is unknown; utility reduced to zero/i);
});

test("old academic citation source becomes supporting evidence", () => {
  const { decision } = evaluated({
    source: "https://scholar.example.edu/foundational-context-aging",
    source_type: "google_scholar",
    semantic_score: 0.88,
    published_at: "2022-03-15T00:00:00.000Z",
  }, {
    sourceProfile: "academic_research",
    intentProfile: "citation_check",
  });

  assert.equal(decision.decision, "cite_as_supporting");
  assert.match(decision.meaning, /useful evidence/i);
});

test("stale but semantically relevant citation source receives supporting caution", () => {
  const { evaluation, decision } = evaluated({
    source: "https://scholar.example.edu/stale-relevant-release-gate",
    source_type: "google_scholar",
    semantic_score: 0.92,
    published_at: "2022-01-01T00:00:00.000Z",
  }, {
    sourceProfile: "academic_research",
    intentProfile: "citation_check",
  });
  const readable = toReadableContextResult(evaluation, decision);

  assert.equal(decision.decision, "cite_as_supporting");
  assert.ok(evaluation.freshness_score !== null && evaluation.freshness_score < 50);
  assert.match(decision.action, /supporting evidence/i);
  assert.equal(readable.label, "Supporting source");
  assert.equal(readable.handoff.safe_for_agent_handoff, true);
});

test("missing-date academic source needs verification", () => {
  const { decision } = evaluated({
    source: "https://research.example.org/context-notes",
    source_type: "google_scholar",
    semantic_score: 0.62,
    published_at: null,
    date_confidence: "unknown",
  }, {
    sourceProfile: "academic_research",
    intentProfile: "student_research",
  });

  assert.equal(decision.decision, "needs_verification");
  assert.match(decision.action, /Verify/i);
});

test("market finance with unknown or stale freshness needs refresh", () => {
  const unknown = evaluated({
    source_type: "finance",
    semantic_score: 0.8,
    published_at: null,
    date_confidence: "unknown",
  }, {
    sourceProfile: "market_finance",
    intentProfile: "market_watch",
  });
  const stale = evaluated({
    source_type: "finance",
    semantic_score: 0.8,
    published_at: "2026-01-01T00:00:00.000Z",
  }, {
    sourceProfile: "market_finance",
    intentProfile: "market_watch",
  });

  assert.equal(unknown.decision.decision, "needs_refresh");
  assert.equal(stale.decision.decision, "needs_refresh");
  assert.match(unknown.decision.warnings.join(" "), /not investment advice/i);
});

test("jobs opportunities with unknown or stale freshness needs refresh", () => {
  const unknown = evaluated({
    source_type: "jobs",
    semantic_score: 0.75,
    published_at: null,
    date_confidence: "unknown",
  }, {
    sourceProfile: "jobs_opportunities",
    intentProfile: "job_search",
  });
  const stale = evaluated({
    source_type: "jobs",
    semantic_score: 0.75,
    published_at: "2026-01-01T00:00:00.000Z",
  }, {
    sourceProfile: "jobs_opportunities",
    intentProfile: "job_search",
  });

  assert.equal(unknown.decision.decision, "needs_refresh");
  assert.equal(stale.decision.decision, "needs_refresh");
  assert.match(stale.decision.warnings.join(" "), /not employment or legal advice/i);
});

test("low-rank social signal becomes watch_only", () => {
  const { decision } = evaluated({
    source: "https://news.ycombinator.com/item?id=1",
    source_type: "hackernews",
    semantic_score: 0.2,
    published_at: "2026-05-24T12:00:00.000Z",
  }, {
    sourceProfile: "social_pulse",
    intentProfile: "developer_adoption",
  });

  assert.equal(decision.decision, "watch_only");
  assert.match(decision.action, /Monitor/i);
});

test("interpretEvaluations preserves input order and adds one decision per evaluation", () => {
  const failed = evaluateSignal(baseInput({
    content: "[ERROR] upstream failure",
    semantic_score: 0.95,
  }), { now: NOW });
  const strong = evaluateSignal(baseInput({
    source: "https://arxiv.org/abs/2605.12345",
    semantic_score: 0.94,
    published_at: "2026-05-20T09:00:00.000Z",
  }), { now: NOW });

  const decisions = interpretEvaluations([failed, strong], {
    sourceProfile: "academic_research",
    intentProfile: "citation_check",
  });

  assert.equal(decisions.length, 2);
  assert.equal(decisions[0].decision, "exclude");
  assert.equal(decisions[1].decision, "cite_as_primary");
});

test("interpretEvaluation does not mutate evaluation", () => {
  const evaluation = evaluateSignal(baseInput({
    metadata: { nested: { value: 1 } },
  }), { now: NOW });
  const before = JSON.stringify(evaluation);

  interpretEvaluation(evaluation, {
    sourceProfile: "academic_research",
    intentProfile: "citation_check",
  });

  assert.equal(JSON.stringify(evaluation), before);
});

test("public decision helper exports are available from src/core/index.ts", () => {
  const evaluation = evaluateSignal(baseInput(), { now: NOW });
  const options: ContextDecisionOptions = {
    sourceProfile: "academic_research",
    intentProfile: "citation_check",
  };
  const decision: ContextDecisionResult = interpretEvaluation(evaluation, options);
  const decisions: ContextDecisionResult[] = interpretEvaluations([evaluation], options);

  assert.equal(typeof interpretEvaluation, "function");
  assert.equal(typeof interpretEvaluations, "function");
  assert.equal(typeof decision.decision, "string");
  assert.equal(decisions.length, 1);
});

test("regulated intent wording keeps non-advice boundaries visible", () => {
  const medical = evaluated({
    source_type: "google_scholar",
    published_at: "2026-05-20T00:00:00.000Z",
    semantic_score: 0.9,
  }, {
    sourceProfile: "academic_research",
    intentProfile: "medical_literature_triage",
  });
  const diligence = evaluated({
    source_type: "company_landscape",
    published_at: "2026-05-20T00:00:00.000Z",
    semantic_score: 0.9,
  }, {
    sourceProfile: "company_intel",
    intentProfile: "business_due_diligence",
  });

  assert.match(medical.decision.warnings.join(" "), /not medical advice/i);
  assert.match(diligence.decision.warnings.join(" "), /not legal, tax, or investment advice/i);
});

test("decision result includes a verdict_id", () => {
  const { decision } = evaluated({
    source: "https://arxiv.org/abs/2605.12345",
    semantic_score: 0.94,
    published_at: "2026-05-20T09:00:00.000Z",
  }, {
    sourceProfile: "academic_research",
    intentProfile: "citation_check",
  });

  assert.equal(typeof decision.verdict_id, "string");
  assert.ok(decision.verdict_id && decision.verdict_id.length > 0);
});

test("verdict_id is deterministic for identical inputs", () => {
  const options: ContextDecisionOptions = {
    sourceProfile: "academic_research",
    intentProfile: "citation_check",
  };
  const overrides: Partial<FreshContextSignalInput> = {
    source: "https://arxiv.org/abs/2605.12345",
    semantic_score: 0.94,
    published_at: "2026-05-20T09:00:00.000Z",
  };

  const first = evaluated(overrides, options);
  const second = evaluated(overrides, options);

  assert.equal(first.decision.verdict_id, second.decision.verdict_id);
});

test("verdict_id changes when the source signal changes", () => {
  const options: ContextDecisionOptions = {
    sourceProfile: "academic_research",
    intentProfile: "citation_check",
  };

  const a = evaluated({
    source: "https://arxiv.org/abs/2605.00001",
    semantic_score: 0.94,
    published_at: "2026-05-20T09:00:00.000Z",
  }, options);
  const b = evaluated({
    source: "https://arxiv.org/abs/2605.99999",
    semantic_score: 0.94,
    published_at: "2026-05-20T09:00:00.000Z",
  }, options);

  assert.equal(a.decision.decision, "cite_as_primary");
  assert.equal(b.decision.decision, "cite_as_primary");
  assert.notEqual(a.decision.verdict_id, b.decision.verdict_id);
});

test("verdict_id is not changed by utility, mirroring the decision-label rule", () => {
  const evaluation = evaluateSignal(baseInput({
    source: "https://arxiv.org/abs/2605.12345",
    source_type: "arxiv",
    semantic_score: 0.94,
    published_at: "2026-05-20T09:00:00.000Z",
  }), { now: NOW });
  const lowUtilityEvaluation: CoreSignalEvaluationResult = {
    ...evaluation,
    utility: {
      ...evaluation.utility,
      score: 0,
      reasons: ["utility was forced low for verdict_id regression coverage"],
    },
  };
  const options: ContextDecisionOptions = {
    sourceProfile: "academic_research",
    intentProfile: "citation_check",
  };

  const normalDecision = interpretEvaluation(evaluation, options);
  const lowUtilityDecision = interpretEvaluation(lowUtilityEvaluation, options);

  assert.equal(normalDecision.verdict_id, lowUtilityDecision.verdict_id);
});

test("verdict_id is not changed by provenance_readiness", () => {
  const evaluation = evaluateSignal(baseInput({
    source: "https://arxiv.org/abs/2605.12345",
    source_type: "arxiv",
    semantic_score: 0.94,
    published_at: "2026-05-20T09:00:00.000Z",
  }), { now: NOW });
  const uncertainReadinessEvaluation: CoreSignalEvaluationResult = {
    ...evaluation,
    provenance_readiness: {
      ...evaluation.provenance_readiness,
      state: "unknown",
      warnings: ["provenance readiness was forced uncertain for verdict_id regression coverage"],
      reasons: ["provenance readiness must remain a sidecar until an explicit policy pass changes it"],
    },
  };
  const options: ContextDecisionOptions = {
    sourceProfile: "academic_research",
    intentProfile: "citation_check",
  };

  const normalDecision = interpretEvaluation(evaluation, options);
  const uncertainReadinessDecision = interpretEvaluation(uncertainReadinessEvaluation, options);

  assert.equal(normalDecision.verdict_id, uncertainReadinessDecision.verdict_id);
});

test("computeVerdictId is exported from src/core/index.ts and matches the decision result", () => {
  const evaluation = evaluateSignal(baseInput({
    source: "https://arxiv.org/abs/2605.12345",
    semantic_score: 0.94,
    published_at: "2026-05-20T09:00:00.000Z",
  }), { now: NOW });
  const decision = interpretEvaluation(evaluation, {
    sourceProfile: "academic_research",
    intentProfile: "citation_check",
  });

  assert.equal(typeof computeVerdictId, "function");
  assert.equal(
    computeVerdictId(evaluation, decision.decision, "academic_research", "citation_check"),
    decision.verdict_id
  );
});

// ─── Pass 21: evaluated_at + revalidate_after ─────────────────────────────────

test("decision result includes evaluated_at honoring the now option", () => {
  const { decision } = evaluated({
    source: "https://arxiv.org/abs/2605.12345",
    semantic_score: 0.94,
    published_at: "2026-05-20T09:00:00.000Z",
  }, {
    sourceProfile: "academic_research",
    intentProfile: "citation_check",
    now: NOW,
  });

  assert.equal(decision.evaluated_at, NOW);
});

test("evaluated_at defaults to wall-clock ISO when now is omitted", () => {
  const before = Date.now();
  const { decision } = evaluated({
    source: "https://arxiv.org/abs/2605.12345",
    semantic_score: 0.94,
    published_at: "2026-05-20T09:00:00.000Z",
  }, {
    sourceProfile: "academic_research",
    intentProfile: "citation_check",
  });
  const after = Date.now();

  assert.equal(typeof decision.evaluated_at, "string");
  const ms = new Date(decision.evaluated_at!).getTime();
  assert.ok(
    ms >= before && ms <= after,
    `evaluated_at ${decision.evaluated_at} should fall between ${before} and ${after}`
  );
});

test("revalidate_after is evaluated_at + 1.0 × source profile half-life", () => {
  const { decision } = evaluated({
    source: "https://arxiv.org/abs/2605.12345",
    semantic_score: 0.94,
    published_at: "2026-05-20T09:00:00.000Z",
  }, {
    sourceProfile: "academic_research",
    intentProfile: "citation_check",
    now: NOW,
  });

  assert.equal(typeof decision.revalidate_after, "string");
  const profile = getSourceProfile("academic_research");
  assert.ok(profile, "academic_research source profile must exist");
  const expected = new Date(
    new Date(NOW).getTime() + profile!.half_life_hours * 60 * 60 * 1000
  ).toISOString();
  assert.equal(decision.revalidate_after, expected);
});

test("revalidate_after is explicit null when no source profile is provided", () => {
  const { decision } = evaluated({
    source: "https://arxiv.org/abs/2605.12345",
    semantic_score: 0.94,
    published_at: "2026-05-20T09:00:00.000Z",
  }, {
    intentProfile: "citation_check",
    now: NOW,
  });

  // Honest null, not undefined, not omitted, not a fabricated timestamp.
  assert.equal(decision.revalidate_after, null);
  assert.ok(
    "revalidate_after" in decision,
    "revalidate_after must be a present key, not omitted"
  );
  // evaluated_at is still populated regardless of profile presence.
  assert.equal(decision.evaluated_at, NOW);
});

test("verdict_id is not changed by now / evaluated_at / revalidate_after", () => {
  const options: ContextDecisionOptions = {
    sourceProfile: "academic_research",
    intentProfile: "citation_check",
  };
  const evaluation = evaluateSignal(baseInput({
    source: "https://arxiv.org/abs/2605.12345",
    semantic_score: 0.94,
    published_at: "2026-05-20T09:00:00.000Z",
  }), { now: NOW });
  const earlier = interpretEvaluation(evaluation, { ...options, now: "2026-01-01T00:00:00.000Z" });
  const later = interpretEvaluation(evaluation, { ...options, now: "2026-12-31T23:59:59.999Z" });

  // verdict_id stays stable across now changes — mirrors the existing
  // utility/provenance_readiness rule. Time fields are not in verdict_id's basis.
  assert.equal(earlier.verdict_id, later.verdict_id);
  // But evaluated_at and revalidate_after DO move with now (they are time-bound by design).
  assert.notEqual(earlier.evaluated_at, later.evaluated_at);
  assert.notEqual(earlier.revalidate_after, later.revalidate_after);
});
