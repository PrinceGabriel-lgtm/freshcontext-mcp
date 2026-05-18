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
} from "../src/core/index.js";
import type {
  AdapterResult,
  ExtractOptions,
  FreshContext,
} from "../src/core/index.js";

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

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

test("Core scoreLabel preserves score bands", () => {
  assert.equal(scoreLabel(null), "unknown");
  assert.equal(scoreLabel(95), "current");
  assert.equal(scoreLabel(75), "reliable");
  assert.equal(scoreLabel(55), "verify before acting");
  assert.equal(scoreLabel(20), "use with caution");
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
