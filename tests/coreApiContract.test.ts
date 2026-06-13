import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateContextUtility,
  calculateHaPriV2,
  calculateFreshnessScore,
  getSourceProfile,
  explainSignal,
  evaluateSignal,
  evaluateSignals,
  formatForLLM,
  interpretEvaluation,
  interpretEvaluations,
  listSourceProfiles,
  looksLikeFailedAdapterContent,
  normalizeSignal,
  prepareProvenanceReadiness,
  rankSignal,
  rankSignals,
  scoreLabel,
  SIGNAL_CONTRACT_VERSION,
  stampFreshness,
  toStructuredJSON,
} from "../src/core/index.js";
import type {
  AdapterResult,
  ContextUtilityInput,
  ContextUtilityResult,
  ContextDecisionOptions,
  ContextDecisionResult,
  CoreSignalEvaluationOptions,
  CoreSignalEvaluationResult,
  EnvelopeFormatOptions,
  ExtractOptions,
  FreshContextSignal,
  FreshContextSignalInput,
  FreshContext,
  FreshSignal,
  HaPriV2Input,
  HaPriV2Result,
  ProvenanceReadinessResult,
  RankedSignal,
  RankOptions,
  SourceProfile,
  SourceProfileId,
} from "../src/core/index.js";

test("public Core API imports compile and callable functions remain available", () => {
  const result: AdapterResult = {
    raw: "Public Core API contract content",
    content_date: "2026-05-24T12:00:00.000Z",
    freshness_confidence: "high",
  };
  const options: ExtractOptions = {
    url: "https://example.com/core-api-contract",
    maxLength: 8000,
  };
  const formatOptions: EnvelopeFormatOptions = {
    unknownDateText: "Published: unknown",
  };

  const ctx: FreshContext = stampFreshness(result, options, "hackernews");
  const structured = toStructuredJSON(ctx) as { content: string };
  const text = formatForLLM(ctx, formatOptions);
  const freshnessScore = calculateFreshnessScore(
    result.content_date,
    ctx.retrieved_at,
    "hackernews"
  );

  assert.equal(structured.content, ctx.content);
  assert.match(text, /\[FRESHCONTEXT\]/);
  assert.equal(typeof freshnessScore, "number");
  assert.equal(typeof scoreLabel(freshnessScore), "string");
  assert.equal(looksLikeFailedAdapterContent(result.raw), false);
  assert.equal(looksLikeFailedAdapterContent("[Error] upstream timeout"), true);
});

test("public signal contract imports compile and normalize signals", () => {
  const input: FreshContextSignalInput = {
    source: "https://example.com/signal-contract",
    source_type: "hackernews",
    content_date: "2026-05-24T12:00:00.000Z",
    retrieved_at: "2026-05-24T13:00:00.000Z",
    semantic_score: 0.9,
    freshness_confidence: "high",
  };

  const signal: FreshContextSignal = normalizeSignal(input);

  assert.equal(SIGNAL_CONTRACT_VERSION, "freshcontext.signal.v1");
  assert.equal(signal.contract_version, SIGNAL_CONTRACT_VERSION);
  assert.equal(signal.published_at, input.content_date);
  assert.equal(signal.date_confidence, "high");
  assert.equal(signal.status, "success");
});

test("public ranking and utility imports compile and remain callable", () => {
  const signal: FreshSignal = {
    source: "https://example.com/ranked",
    source_type: "hackernews",
    published_at: "2026-05-24T12:00:00.000Z",
    retrieved_at: "2026-05-24T13:00:00.000Z",
    semantic_score: 0.85,
    content: "Relevant public Core ranking contract content",
  };
  const rankOptions: RankOptions = {
    now: "2026-05-24T13:00:00.000Z",
    defaultSourceType: "hackernews",
  };

  const ranked: RankedSignal = rankSignal(signal, rankOptions);
  const rankedSignals: RankedSignal[] = rankSignals([signal], rankOptions);

  assert.equal(rankedSignals.length, 1);
  assert.equal(typeof ranked.reason, "string");
  assert.equal(explainSignal(ranked), ranked.reason);

  const utilityInput: ContextUtilityInput = {
    contextualRelevance: 80,
    lambda: 0.01,
    ageHours: 24,
    dateConfidence: "high",
    status: "success",
  };
  const utility: ContextUtilityResult = calculateContextUtility(utilityInput);

  assert.equal(typeof utility.score, "number");

  const haPriInput: HaPriV2Input = {
    resultId: "sr_public_contract",
    rawContent: "Public Core provenance contract content",
    semanticFingerprint: "public-core-fingerprint",
    adapter: "hackernews",
    publishedAt: "2026-05-24T12:00:00.000Z",
    retrievedAt: "2026-05-24T13:00:00.000Z",
    engineVersion: "freshcontext-0.3.17",
  };
  const haPri: HaPriV2Result = calculateHaPriV2(haPriInput);

  assert.match(haPri.haPriSigV2, /^[a-f0-9]{64}$/);
});

test("public Core evaluation pipeline imports compile and remain callable", () => {
  const options: CoreSignalEvaluationOptions = {
    now: "2026-05-24T13:00:00.000Z",
    includeEnvelope: true,
  };
  const evaluation: CoreSignalEvaluationResult = evaluateSignal({
    source: "https://example.com/evaluate",
    source_type: "hackernews",
    content: "Public Core evaluation contract content",
    published_at: "2026-05-24T12:00:00.000Z",
    retrieved_at: "2026-05-24T13:00:00.000Z",
    semantic_score: 0.8,
    date_confidence: "high",
  }, options);
  const evaluations: CoreSignalEvaluationResult[] = evaluateSignals([
    {
      source: "https://example.com/evaluate",
      source_type: "hackernews",
      content: "Public Core evaluation contract content",
      published_at: "2026-05-24T12:00:00.000Z",
      retrieved_at: "2026-05-24T13:00:00.000Z",
      semantic_score: 0.8,
      date_confidence: "high",
    },
  ], options);

  assert.equal(typeof evaluation.explanation, "string");
  assert.equal(typeof evaluation.utility.score, "number");
  assert.ok(evaluation.envelope);
  assert.equal(evaluations.length, 1);
});

test("public source profile imports compile and remain callable", () => {
  const profileId: SourceProfileId = "official_docs";
  const profile: SourceProfile | undefined = getSourceProfile(profileId);
  const profiles: SourceProfile[] = listSourceProfiles();

  assert.ok(profile);
  assert.equal(profile.profile_id, profileId);
  assert.ok(profiles.length >= 10);
});

test("public decision helper imports compile and remain callable", () => {
  const evaluation: CoreSignalEvaluationResult = evaluateSignal({
    source: "https://example.com/decision",
    source_type: "arxiv",
    content: "Public Core decision helper contract content",
    published_at: "2026-05-24T12:00:00.000Z",
    retrieved_at: "2026-05-24T13:00:00.000Z",
    semantic_score: 0.9,
    date_confidence: "high",
  }, {
    now: "2026-05-24T13:00:00.000Z",
  });
  const options: ContextDecisionOptions = {
    sourceProfile: "academic_research",
    intentProfile: "citation_check",
  };
  const decision: ContextDecisionResult = interpretEvaluation(evaluation, options);
  const decisions: ContextDecisionResult[] = interpretEvaluations([evaluation], options);

  assert.equal(typeof decision.decision, "string");
  assert.equal(typeof decision.meaning, "string");
  assert.equal(decisions.length, 1);
});


test("public provenance readiness helper imports compile and remains callable", () => {
  const readiness: ProvenanceReadinessResult = prepareProvenanceReadiness({
    id: "public_readiness",
    source: "https://example.com/readiness",
    source_type: "official_docs",
    content: "Public Core provenance readiness contract content",
    published_at: "2026-05-24T12:00:00.000Z",
    retrieved_at: "2026-05-24T13:00:00.000Z",
    semantic_score: 0.8,
    date_confidence: "high",
  }, {
    resultId: "public_readiness",
    semanticFingerprint: "public-readiness-fingerprint",
    engineVersion: "freshcontext-0.3.20",
  });

  assert.equal(readiness.state, "complete");
  assert.deepEqual(Object.keys(readiness).sort(), [
    "canonical_content_sha256",
    "ha_pri_v2",
    "published_at",
    "reasons",
    "retrieved_at",
    "semantic_fingerprint_sha256",
    "source_identity",
    "source_type",
    "state",
    "timing_completeness",
    "timing_confidence",
    "warnings",
  ]);
  assert.deepEqual(Object.keys(readiness.source_identity).sort(), [
    "completeness",
    "result_id",
    "source",
    "source_type",
  ]);
  assert.equal(readiness.source_identity.completeness, "complete");
  assert.equal(readiness.timing_completeness, "complete");
  assert.match(readiness.canonical_content_sha256 ?? "", /^[a-f0-9]{64}$/);
  assert.match(readiness.semantic_fingerprint_sha256 ?? "", /^[a-f0-9]{64}$/);
  assert.ok(readiness.ha_pri_v2);
});
