import test, { describe } from "node:test";
import assert from "node:assert/strict";
import {
  calculateFreshnessScore,
  computeRevalidateAfter,
  evaluateSignal,
  formatForLLM,
  LAMBDA,
  stalenessVerdict,
  stampFreshness,
  toStructuredJSON,
} from "../src/core/index.js";

// hackernews: lambda 0.05, half-life ~13.86h — fast enough to reason about by hand.
const SOURCE_URL = "https://example.com/staleness";
const ADAPTER = "hackernews";

describe("Brick 6 — staleness verdict + revalidate_after (the 'eyes')", () => {
  // ── stalenessVerdict: pure mapping, derived from the EXISTING score buckets ──

  test("stalenessVerdict maps score buckets to fresh/aging/stale/unknown", () => {
    assert.equal(stalenessVerdict(null), "unknown");
    assert.equal(stalenessVerdict(100), "fresh");
    assert.equal(stalenessVerdict(90), "fresh");
    assert.equal(stalenessVerdict(70), "fresh");  // boundary: >=70 is fresh
    assert.equal(stalenessVerdict(69), "aging");
    assert.equal(stalenessVerdict(50), "aging");  // boundary: >=50 is aging
    assert.equal(stalenessVerdict(49), "stale");
    assert.equal(stalenessVerdict(0), "stale");
  });

  // ── computeRevalidateAfter: independently verify the math ──

  test("revalidate_after lands at exactly one half-life past content_date — the point score crosses 50", () => {
    const contentDate = "2026-06-01T00:00:00.000Z";
    const lambda = LAMBDA[ADAPTER];
    const halfLifeHours = Math.log(2) / lambda;
    const expectedMs = new Date(contentDate).getTime() + halfLifeHours * 60 * 60 * 1000;

    const revalidateAfter = computeRevalidateAfter(contentDate, "2026-06-30T00:00:00.000Z", ADAPTER);
    assert.ok(revalidateAfter !== null);
    assert.ok(
      Math.abs(new Date(revalidateAfter as string).getTime() - expectedMs) < 1,
      "revalidate_after must equal content_date + half_life_hours(adapter)"
    );

    // Independent verification: recompute freshness_score AT revalidate_after — must be ~50.
    const scoreAtBoundary = calculateFreshnessScore(contentDate, revalidateAfter as string, ADAPTER);
    assert.ok(scoreAtBoundary !== null);
    assert.ok(
      Math.abs((scoreAtBoundary as number) - 50) <= 1,
      `score at revalidate_after should be ~50, got ${scoreAtBoundary}`
    );
  });

  test("revalidate_after is null when content_date is null", () => {
    assert.equal(computeRevalidateAfter(null, "2026-06-30T00:00:00.000Z", ADAPTER), null);
  });

  test("revalidate_after is null for a meaningfully future-dated content_date (matches freshness_score null)", () => {
    const retrievedAt = "2026-06-30T00:00:00.000Z";
    const futureContentDate = "2026-07-15T00:00:00.000Z"; // well beyond clock-skew tolerance
    assert.equal(calculateFreshnessScore(futureContentDate, retrievedAt, ADAPTER), null);
    assert.equal(computeRevalidateAfter(futureContentDate, retrievedAt, ADAPTER), null);
  });

  // ── stampFreshness / envelope wiring — the actual "eyes" ──

  test("stampFreshness populates staleness consistently with freshness_score", () => {
    const ctx = stampFreshness({
      raw: "Some real content body for staleness testing.",
      content_date: "2026-01-01T00:00:00.000Z",
      freshness_confidence: "high",
    }, { url: SOURCE_URL, maxLength: 8000 }, ADAPTER);

    assert.equal(ctx.staleness, stalenessVerdict(ctx.freshness_score));
    if (ctx.freshness_score === null) {
      assert.equal(ctx.revalidate_after, null);
    } else {
      assert.ok(ctx.revalidate_after !== null);
      assert.match(ctx.revalidate_after as string, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    }
  });

  test("null content_date produces staleness unknown and revalidate_after null in the envelope", () => {
    const ctx = stampFreshness({
      raw: "No date body",
      content_date: null,
      freshness_confidence: "medium",
    }, { url: SOURCE_URL, maxLength: 8000 }, ADAPTER);

    assert.equal(ctx.freshness_score, null);
    assert.equal(ctx.staleness, "unknown");
    assert.equal(ctx.revalidate_after, null);
  });

  // ── toStructuredJSON surfaces both new fields, additively ──

  test("toStructuredJSON includes staleness and revalidate_after in the freshcontext block", () => {
    const ctx = stampFreshness({
      raw: "Structured body",
      content_date: "2026-06-29T00:00:00.000Z",
      freshness_confidence: "high",
    }, { url: SOURCE_URL, maxLength: 8000 }, ADAPTER);
    const structured = toStructuredJSON(ctx) as {
      freshcontext: { staleness: string; revalidate_after: string | null };
    };

    assert.equal(structured.freshcontext.staleness, ctx.staleness);
    assert.equal(structured.freshcontext.revalidate_after, ctx.revalidate_after);
  });

  // ── formatForLLM: the one new human-legible line ──

  test("formatForLLM emits a Staleness line with the revalidate-by timestamp when known", () => {
    const ctx = stampFreshness({
      raw: "Fresh body",
      content_date: "2026-06-29T23:00:00.000Z",
      freshness_confidence: "high",
    }, { url: SOURCE_URL, maxLength: 8000 }, ADAPTER);
    const text = formatForLLM(ctx);

    assert.ok(ctx.revalidate_after !== null);
    assert.match(text, new RegExp(`Staleness: ${ctx.staleness} \\(revalidate by ${ctx.revalidate_after}\\)`));
  });

  test("formatForLLM emits a bare 'Staleness: unknown' line when content_date is missing", () => {
    const ctx = stampFreshness({
      raw: "No date body",
      content_date: null,
      freshness_confidence: "medium",
    }, { url: SOURCE_URL, maxLength: 8000 }, ADAPTER);
    const text = formatForLLM(ctx);

    assert.match(text, /Staleness: unknown\n/);
    assert.doesNotMatch(text, /revalidate by/);
  });

  // ── additive guard: existing score fields stay exactly as they are ──

  test("existing Score line and freshness_score/freshness_confidence fields are unchanged", () => {
    const ctx = stampFreshness({
      raw: "Unchanged body",
      content_date: "2026-06-29T23:00:00.000Z",
      freshness_confidence: "high",
    }, { url: SOURCE_URL, maxLength: 8000 }, ADAPTER);
    const text = formatForLLM(ctx);

    assert.match(text, /Score: \d+\/100 \(.+\)/);
    assert.equal(typeof ctx.freshness_score, "number");
    assert.equal(ctx.freshness_confidence, "high");
  });

  // ── second construction site: pipeline.ts's createEnvelope (evaluateSignal) ──

  test("evaluateSignal's envelope (pipeline.ts createEnvelope) also carries staleness + revalidate_after", () => {
    const result = evaluateSignal({
      id: "staleness-pipeline-001",
      source: "https://example.com/pipeline-signal",
      source_type: ADAPTER,
      content: "Pipeline envelope staleness test content.",
      published_at: "2026-01-01T00:00:00.000Z",
      retrieved_at: "2026-06-30T00:00:00.000Z",
      date_confidence: "high",
      status: "success",
    }, {
      now: "2026-06-30T00:00:00.000Z",
      includeEnvelope: true,
    });

    assert.ok(result.envelope);
    assert.equal(result.envelope?.context.staleness, stalenessVerdict(result.freshness_score));
    if (result.freshness_score === null) {
      assert.equal(result.envelope?.context.revalidate_after, null);
    } else {
      assert.ok(result.envelope?.context.revalidate_after !== null);
    }
  });

  test("evaluateSignal's envelope: failed-status signal forces staleness unknown + revalidate_after null", () => {
    const result = evaluateSignal({
      id: "staleness-pipeline-002",
      source: "https://example.com/pipeline-signal-failed",
      source_type: ADAPTER,
      content: "[ERROR] upstream failure",
      published_at: "2026-01-01T00:00:00.000Z",
      retrieved_at: "2026-06-30T00:00:00.000Z",
      date_confidence: "high",
      status: "failed",
    }, {
      now: "2026-06-30T00:00:00.000Z",
      includeEnvelope: true,
    });

    assert.ok(result.envelope);
    assert.equal(result.envelope?.context.staleness, "unknown");
    assert.equal(result.envelope?.context.revalidate_after, null);
  });
});
