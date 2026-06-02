import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateSignal,
  interpretEvaluation,
  interpretEvaluations,
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
