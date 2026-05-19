import test from "node:test";
import assert from "node:assert/strict";
import freshcontextEnvelope from "../worker/src/freshcontextEnvelope.ts";

const {
  analyzeCompositeContent,
  isUncacheableContent,
  parseFreshContextJson,
  replaceFreshContextJson,
  stamp,
} = freshcontextEnvelope;

type WorkerEnvelope = {
  freshcontext: {
    source_url: string;
    content_date: string | null;
    retrieved_at: string;
    freshness_confidence: "high" | "medium" | "low";
    freshness_score: number | null;
    adapter: string;
  };
  content: string;
  cache?: Record<string, unknown>;
};

function parsedEnvelope(text: string): WorkerEnvelope {
  const parsed = parseFreshContextJson(text);
  assert.ok(parsed, "expected FreshContext JSON envelope");
  return parsed as WorkerEnvelope;
}

test("Worker stamp emits Worker-style FreshContext text and JSON envelopes", () => {
  const text = stamp(
    "Worker envelope content",
    "https://example.com/worker",
    "2026-05-13T09:00:00.000Z",
    "high",
    "hackernews"
  );
  const parsed = parsedEnvelope(text);

  assert.match(text, /\[FRESHCONTEXT\]/);
  assert.match(text, /Source: https:\/\/example\.com\/worker/);
  assert.match(text, /Published: 2026-05-13T09:00:00\.000Z/);
  assert.match(text, /Retrieved:/);
  assert.match(text, /Confidence: high/);
  assert.match(text, /Score:/);
  assert.match(text, /\[FRESHCONTEXT_JSON\]/);
  assert.equal(parsed.freshcontext.source_url, "https://example.com/worker");
  assert.equal(parsed.freshcontext.content_date, "2026-05-13T09:00:00.000Z");
  assert.equal(parsed.freshcontext.freshness_confidence, "high");
  assert.equal(parsed.freshcontext.adapter, "hackernews");
  assert.equal(typeof parsed.freshcontext.freshness_score, "number");
});

test("Worker stamp missing date emits exact Worker unknown-date text", () => {
  const text = stamp("No date content", "https://example.com/no-date", null, "medium", "hackernews");
  const parsed = parsedEnvelope(text);

  assert.match(text, /Published: unknown/);
  assert.doesNotMatch(text, /Publish date: unknown/);
  assert.equal(parsed.freshcontext.content_date, null);
  assert.equal(parsed.freshcontext.freshness_score, null);
});

test("Worker stamp failure-looking content downgrades confidence and clears freshness", () => {
  for (const raw of ["[Error] upstream timeout", "[Security] blocked", "timeout"]) {
    const text = stamp(raw, "https://example.com/failure", "2026-05-13T09:00:00.000Z", "high", "hackernews");
    const parsed = parsedEnvelope(text);

    assert.match(text, /Confidence: low/);
    assert.match(text, /Score: unknown/);
    assert.equal(parsed.freshcontext.content_date, null);
    assert.equal(parsed.freshcontext.freshness_confidence, "low");
    assert.equal(parsed.freshcontext.freshness_score, null);
  }
});

test("Worker stamp truncates content at 6000 characters", () => {
  const longContent = "x".repeat(6100);
  const text = stamp(longContent, "https://example.com/long", "2026-05-13T09:00:00.000Z", "high", "hackernews");
  const parsed = parsedEnvelope(text);

  assert.equal(parsed.content.length, 6000);
  assert.equal(parsed.content, "x".repeat(6000));
});

test("parseFreshContextJson parses valid blocks and rejects missing or malformed blocks", () => {
  const text = stamp("Parse me", "https://example.com/parse", "2026-05-13T09:00:00.000Z", "high", "hackernews");

  assert.ok(parseFreshContextJson(text));
  assert.equal(parseFreshContextJson("plain text without JSON block"), null);
  assert.equal(parseFreshContextJson("[FRESHCONTEXT_JSON]\nnot json\n[/FRESHCONTEXT_JSON]"), null);
});

test("replaceFreshContextJson replaces only the JSON block and can add cache metadata", () => {
  const text = stamp("Cache me", "https://example.com/cache", "2026-05-13T09:00:00.000Z", "high", "hackernews");
  const parsed = parsedEnvelope(text);
  const replaced = replaceFreshContextJson(text, {
    ...parsed,
    cache: {
      status: "hit",
      cached_at: "2026-05-13T09:01:00.000Z",
      cache_age_seconds: 12,
      ttl_seconds: 900,
      key_version: "v2",
    },
  });
  const reparsed = parsedEnvelope(replaced);

  assert.match(replaced, /\[FRESHCONTEXT\]/);
  assert.match(replaced, /Source: https:\/\/example\.com\/cache/);
  assert.equal(reparsed.freshcontext.source_url, parsed.freshcontext.source_url);
  assert.equal(reparsed.cache?.status, "hit");
  assert.equal(reparsed.cache?.key_version, "v2");
});

test("isUncacheableContent blocks only empty and hard error output at this layer", () => {
  assert.equal(isUncacheableContent(""), true);
  assert.equal(isUncacheableContent("   "), true);
  assert.equal(isUncacheableContent("[ERROR] upstream failed"), true);
  assert.equal(isUncacheableContent("plain text without JSON block"), false);
});

test("analyzeCompositeContent distinguishes all-unavailable, partial, and non-section content", () => {
  assert.deepEqual(analyzeCompositeContent([
    "## First",
    "[Unavailable: timeout]",
    "",
    "## Second",
    "Error",
  ].join("\n")), {
    allUnavailable: true,
    hasPartialFailures: true,
  });

  assert.deepEqual(analyzeCompositeContent([
    "## First",
    "[Unavailable: timeout]",
    "",
    "## Second",
    "Useful result",
  ].join("\n")), {
    allUnavailable: false,
    hasPartialFailures: true,
  });

  assert.deepEqual(analyzeCompositeContent("Useful single-adapter content\n[Unavailable: not a section]"), {
    allUnavailable: false,
    hasPartialFailures: false,
  });
});
