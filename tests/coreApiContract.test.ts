import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateContextUtility,
  calculateHaPriV2,
  calculateFreshnessScore,
  explainSignal,
  formatForLLM,
  looksLikeFailedAdapterContent,
  rankSignal,
  rankSignals,
  scoreLabel,
  stampFreshness,
  toStructuredJSON,
} from "../src/core/index.js";
import type {
  AdapterResult,
  ContextUtilityInput,
  ContextUtilityResult,
  EnvelopeFormatOptions,
  ExtractOptions,
  FreshContext,
  FreshSignal,
  HaPriV2Input,
  HaPriV2Result,
  RankedSignal,
  RankOptions,
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

