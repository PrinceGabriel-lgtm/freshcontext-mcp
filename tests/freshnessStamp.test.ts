import test from "node:test";
import assert from "node:assert/strict";
import { stampFreshness, formatForLLM } from "../src/tools/freshnessStamp.js";
import { stampFreshness as stampFreshnessFromCore, formatForLLM as formatForLLMFromCore } from "../src/core/index.js";
import type { AdapterResult, FreshContext } from "../src/types.js";
import type { AdapterResult as CoreAdapterResult, FreshContext as CoreFreshContext } from "../src/core/index.js";

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function stamp(
  result: AdapterResult,
  adapter = "hackernews",
  url = "https://example.com/item"
): FreshContext {
  return stampFreshness(result, { url, maxLength: 8000 }, adapter);
}

function parseFreshContextJson(text: string): {
  freshcontext: {
    source_url: string;
    content_date: string | null;
    retrieved_at: string;
    freshness_confidence: "high" | "medium" | "low";
    freshness_score: number | null;
    adapter: string;
  };
  content: string;
} {
  const match = text.match(/\[FRESHCONTEXT_JSON\]\s*([\s\S]*?)\s*\[\/FRESHCONTEXT_JSON\]/);
  assert.ok(match, "Missing [FRESHCONTEXT_JSON] block");
  return JSON.parse(match[1]);
}

test("valid ISO content_date produces a numeric freshness_score", () => {
  const ctx = stamp({
    raw: "A real retrieved result",
    content_date: hoursAgo(2),
    freshness_confidence: "high",
  });

  assert.equal(typeof ctx.freshness_score, "number");
  assert.ok(ctx.freshness_score !== null && ctx.freshness_score >= 0 && ctx.freshness_score <= 100);
});

test("missing content_date produces null freshness_score", () => {
  const ctx = stamp({
    raw: "A result with no publish date",
    content_date: null,
    freshness_confidence: "medium",
  });

  assert.equal(ctx.freshness_score, null);
});

test("invalid content_date produces null freshness_score", () => {
  const ctx = stamp({
    raw: "A result with an invalid publish date",
    content_date: "not-a-date",
    freshness_confidence: "medium",
  });

  assert.equal(ctx.freshness_score, null);
});

test("adapter-specific decay behavior is preserved", () => {
  const content_date = hoursAgo(48);
  const result: AdapterResult = {
    raw: "Same signal, different adapter decay",
    content_date,
    freshness_confidence: "high",
  };

  const hn = stamp(result, "hackernews");
  const github = stamp(result, "github");

  assert.equal(typeof hn.freshness_score, "number");
  assert.equal(typeof github.freshness_score, "number");
  assert.ok((github.freshness_score ?? 0) > (hn.freshness_score ?? 0));
});

test("future dates beyond tolerance are not treated as fresh", { skip: "Current MCP stamping clamps future dates to fresh; activate when Core guards are extracted." }, () => {
  const ctx = stamp({
    raw: "Future-dated result",
    content_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    freshness_confidence: "high",
  });

  assert.notEqual(ctx.freshness_score, 100);
});

test("text envelope includes FreshContext fields", () => {
  const ctx = stamp({
    raw: "Envelope content",
    content_date: hoursAgo(1),
    freshness_confidence: "high",
  });
  const text = formatForLLM(ctx);

  assert.match(text, /\[FRESHCONTEXT\]/);
  assert.match(text, /Source: https:\/\/example\.com\/item/);
  assert.match(text, /Published:/);
  assert.match(text, /Retrieved:/);
  assert.match(text, /Confidence: high/);
  assert.match(text, /\[\/FRESHCONTEXT\]/);
});

test("structured JSON envelope exposes freshness metadata", () => {
  const ctx = stamp({
    raw: "Structured content",
    content_date: hoursAgo(1),
    freshness_confidence: "high",
  });
  const parsed = parseFreshContextJson(formatForLLM(ctx));

  assert.equal(parsed.freshcontext.source_url, "https://example.com/item");
  assert.equal(parsed.freshcontext.content_date, ctx.content_date);
  assert.equal(parsed.freshcontext.retrieved_at, ctx.retrieved_at);
  assert.equal(parsed.freshcontext.freshness_confidence, "high");
  assert.equal(parsed.freshcontext.freshness_score, ctx.freshness_score);
  assert.equal(parsed.freshcontext.adapter, "hackernews");
});

test("error-looking adapter output downgrades confidence and clears content_date", () => {
  const ctx = stamp({
    raw: "[Error] upstream timeout",
    content_date: hoursAgo(1),
    freshness_confidence: "high",
  });
  const text = formatForLLM(ctx);

  assert.equal(ctx.content_date, null);
  assert.equal(ctx.freshness_confidence, "low");
  assert.equal(ctx.freshness_score, null);
  assert.doesNotMatch(text, /Confidence:\s*high/i);
  assert.doesNotMatch(text, /Score:\s*100\/100/i);
});

test("empty, security, and timeout-only output are treated as low-confidence failures", () => {
  const cases: string[] = [
    "",
    "[Security] Domain not allowed",
    "timeout",
    "failed\n404",
  ];

  for (const raw of cases) {
    const ctx = stamp({
      raw,
      content_date: hoursAgo(1),
      freshness_confidence: "high",
    });

    assert.equal(ctx.content_date, null, `content_date should be cleared for ${JSON.stringify(raw)}`);
    assert.equal(ctx.freshness_confidence, "low", `confidence should be low for ${JSON.stringify(raw)}`);
    assert.equal(ctx.freshness_score, null, `freshness_score should be null for ${JSON.stringify(raw)}`);
    assert.doesNotMatch(formatForLLM(ctx), /Score:\s*100\/100/i);
  }
});

test("Core exports are directly consumable and match the compatibility wrapper", () => {
  const result: CoreAdapterResult = {
    raw: "Core seam content",
    content_date: hoursAgo(1),
    freshness_confidence: "high",
  };

  const ctx: CoreFreshContext = stampFreshnessFromCore(
    result,
    { url: "https://example.com/core", maxLength: 8000 },
    "hackernews"
  );
  const text = formatForLLMFromCore(ctx);

  assert.equal(ctx.source_url, "https://example.com/core");
  assert.equal(typeof ctx.freshness_score, "number");
  assert.match(text, /\[FRESHCONTEXT_JSON\]/);
});
