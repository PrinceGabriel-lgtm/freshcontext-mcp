import test from "node:test";
import assert from "node:assert/strict";
import {
  formatForLLM,
  stampFreshness,
  toStructuredJSON,
} from "../src/core/index.js";
import type { EnvelopeFormatOptions } from "../src/core/index.js";

const SOURCE_URL = "https://example.com/core-options";
const CONTENT_DATE = "2026-05-13T09:00:00.000Z";
const ADAPTER = "github";

function parseCoreJson(text: string): {
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
  assert.ok(match, "expected FreshContext JSON block");
  return JSON.parse(match[1]);
}

test("Core envelope defaults preserve current missing-date text and max length", () => {
  const ctx = stampFreshness({
    raw: "x".repeat(8100),
    content_date: null,
    freshness_confidence: "medium",
  }, { url: SOURCE_URL }, ADAPTER);
  const text = formatForLLM(ctx);

  assert.match(text, /Publish date: unknown/);
  assert.doesNotMatch(text, /Published: unknown/);
  assert.equal(ctx.content.length, 8000);
});

test("Core can emit Worker-compatible missing-date text when explicitly requested", () => {
  const options: EnvelopeFormatOptions = {
    unknownDateText: "Published: unknown",
  };
  const ctx = stampFreshness({
    raw: "Missing date body",
    content_date: null,
    freshness_confidence: "medium",
  }, { url: SOURCE_URL, maxLength: 8000 }, ADAPTER);
  const text = formatForLLM(ctx, options);

  assert.match(text, /Published: unknown/);
  assert.doesNotMatch(text, /Publish date: unknown/);
});

test("Core can cap content at the Worker target length through maxLength", () => {
  const ctx = stampFreshness({
    raw: "y".repeat(7001),
    content_date: CONTENT_DATE,
    freshness_confidence: "high",
  }, { url: SOURCE_URL, maxLength: 6000 }, ADAPTER);

  assert.equal(ctx.content.length, 6000);
  assert.equal(ctx.content, "y".repeat(6000));
});

test("Core JSON shape remains unchanged when envelope formatting options are used", () => {
  const ctx = stampFreshness({
    raw: "Structured body",
    content_date: CONTENT_DATE,
    freshness_confidence: "high",
  }, { url: SOURCE_URL, maxLength: 8000 }, ADAPTER);
  const text = formatForLLM(ctx, { unknownDateText: "Published: unknown" });
  const parsed = parseCoreJson(text);
  const structured = toStructuredJSON(ctx);

  assert.deepEqual(parsed, structured);
  assert.deepEqual(Object.keys(parsed), ["freshcontext", "content"]);
  assert.deepEqual(Object.keys(parsed.freshcontext), [
    "source_url",
    "content_date",
    "retrieved_at",
    "freshness_confidence",
    "freshness_score",
    "adapter",
    "staleness",
    "revalidate_after",
  ]);
});

test("Core failure downgrade behavior remains unchanged with formatting options", () => {
  const ctx = stampFreshness({
    raw: "[Error] upstream timeout",
    content_date: CONTENT_DATE,
    freshness_confidence: "high",
  }, { url: SOURCE_URL, maxLength: 8000 }, ADAPTER);
  const text = formatForLLM(ctx, { unknownDateText: "Published: unknown" });
  const parsed = parseCoreJson(text);

  assert.equal(ctx.content_date, null);
  assert.equal(ctx.freshness_confidence, "low");
  assert.equal(ctx.freshness_score, null);
  assert.match(text, /Published: unknown/);
  assert.equal(parsed.freshcontext.content_date, null);
  assert.equal(parsed.freshcontext.freshness_confidence, "low");
  assert.equal(parsed.freshcontext.freshness_score, null);
});
