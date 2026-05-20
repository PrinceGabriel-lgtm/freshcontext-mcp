import test from "node:test";
import assert from "node:assert/strict";
import workerEnvelope from "../worker/src/freshcontextEnvelope.ts";
import {
  formatForLLM,
  looksLikeFailedAdapterContent as coreLooksLikeFailedAdapterContent,
  stampFreshness,
  toStructuredJSON,
} from "../src/core/index.js";

const {
  looksLikeFailedAdapterContent: workerLooksLikeFailedAdapterContent,
  parseFreshContextJson: parseWorkerJson,
  replaceFreshContextJson,
  stamp: workerStamp,
} = workerEnvelope;

type EnvelopeJson = {
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

const SOURCE_URL = "https://example.com/source";
const CONTENT_DATE = "2026-05-13T09:00:00.000Z";
const ADAPTER = "github";

function assertIsoString(value: string): void {
  assert.equal(new Date(value).toISOString(), value);
}

function parseCoreJson(text: string): EnvelopeJson {
  const match = text.match(/\[FRESHCONTEXT_JSON\]\s*([\s\S]*?)\s*\[\/FRESHCONTEXT_JSON\]/);
  assert.ok(match, "expected Core FreshContext JSON block");
  return JSON.parse(match[1]) as EnvelopeJson;
}

function parseWorkerEnvelope(text: string): EnvelopeJson {
  const parsed = parseWorkerJson(text);
  assert.ok(parsed, "expected Worker FreshContext JSON block");
  return parsed as EnvelopeJson;
}

test("Worker and Core share JSON freshness invariants for valid content", () => {
  const workerText = workerStamp("Fresh result body", SOURCE_URL, CONTENT_DATE, "high", ADAPTER);
  const coreContext = stampFreshness({
    raw: "Fresh result body",
    content_date: CONTENT_DATE,
    freshness_confidence: "high",
  }, { url: SOURCE_URL, maxLength: 8000 }, ADAPTER);
  const coreText = formatForLLM(coreContext);

  const workerJson = parseWorkerEnvelope(workerText);
  const coreJson = parseCoreJson(coreText);

  assert.equal(workerJson.freshcontext.source_url, SOURCE_URL);
  assert.equal(coreJson.freshcontext.source_url, SOURCE_URL);
  assert.equal(workerJson.freshcontext.content_date, CONTENT_DATE);
  assert.equal(coreJson.freshcontext.content_date, CONTENT_DATE);
  assert.equal(workerJson.freshcontext.freshness_confidence, "high");
  assert.equal(coreJson.freshcontext.freshness_confidence, "high");
  assert.equal(typeof workerJson.freshcontext.freshness_score, "number");
  assert.equal(typeof coreJson.freshcontext.freshness_score, "number");
  assertIsoString(workerJson.freshcontext.retrieved_at);
  assertIsoString(coreJson.freshcontext.retrieved_at);
  assert.equal(workerJson.content, "Fresh result body");
  assert.deepEqual(coreJson, toStructuredJSON(coreContext));
});

test("missing-date text format difference is documented before migration", () => {
  const workerText = workerStamp("Missing date body", SOURCE_URL, null, "medium", ADAPTER);
  const coreText = formatForLLM(stampFreshness({
    raw: "Missing date body",
    content_date: null,
    freshness_confidence: "medium",
  }, { url: SOURCE_URL, maxLength: 8000 }, ADAPTER));

  assert.match(workerText, /Published: unknown/);
  assert.doesNotMatch(workerText, /Publish date: unknown/);
  assert.match(coreText, /Publish date: unknown/);
  assert.doesNotMatch(coreText, /Published: unknown/);
});

test("Worker and Core max-length behavior is pinned as intentionally different", () => {
  const longContent = "x".repeat(7001);
  const workerText = workerStamp(longContent, SOURCE_URL, CONTENT_DATE, "high", ADAPTER);
  const coreContext = stampFreshness({
    raw: longContent,
    content_date: CONTENT_DATE,
    freshness_confidence: "high",
  }, { url: SOURCE_URL }, ADAPTER);

  assert.equal(parseWorkerEnvelope(workerText).content.length, 6000);
  assert.equal(coreContext.content.length, 7001);
  assert.notEqual(coreContext.content.length, 6000);
});

test("failure-content guards and stamped metadata stay aligned", () => {
  for (const raw of ["[Error] upstream timeout", "[Security] blocked", "timeout"]) {
    assert.equal(workerLooksLikeFailedAdapterContent(raw), true);
    assert.equal(coreLooksLikeFailedAdapterContent(raw), true);

    const workerJson = parseWorkerEnvelope(workerStamp(raw, SOURCE_URL, CONTENT_DATE, "high", ADAPTER));
    const coreContext = stampFreshness({
      raw,
      content_date: CONTENT_DATE,
      freshness_confidence: "high",
    }, { url: SOURCE_URL, maxLength: 8000 }, ADAPTER);

    assert.equal(workerJson.freshcontext.content_date, null);
    assert.equal(workerJson.freshcontext.freshness_confidence, "low");
    assert.equal(workerJson.freshcontext.freshness_score, null);
    assert.equal(coreContext.content_date, null);
    assert.equal(coreContext.freshness_confidence, "low");
    assert.equal(coreContext.freshness_score, null);
  }
});

test("Worker JSON block replacement keeps cache metadata Worker-owned", () => {
  const workerText = workerStamp("Cache body", SOURCE_URL, CONTENT_DATE, "high", ADAPTER);
  const parsed = parseWorkerEnvelope(workerText);
  const replaced = replaceFreshContextJson(workerText, {
    ...parsed,
    cache: {
      status: "hit",
      cached_at: "2026-05-13T09:01:00.000Z",
      cache_age_seconds: 12,
      ttl_seconds: 900,
      key_version: "v2",
    },
  });
  const reparsed = parseWorkerEnvelope(replaced);

  assert.match(replaced, /\[FRESHCONTEXT\]/);
  assert.match(replaced, /Published: 2026-05-13T09:00:00\.000Z/);
  assert.match(replaced, /Cache body/);
  assert.equal(reparsed.freshcontext.source_url, SOURCE_URL);
  assert.equal(reparsed.cache?.status, "hit");
  assert.equal(reparsed.cache?.key_version, "v2");

  const coreJson = toStructuredJSON(stampFreshness({
    raw: "Cache body",
    content_date: CONTENT_DATE,
    freshness_confidence: "high",
  }, { url: SOURCE_URL, maxLength: 8000 }, ADAPTER)) as EnvelopeJson;

  assert.equal(coreJson.cache, undefined);
});

test("Worker and Core envelope format differences are documented before migration", () => {
  const longContent = "y".repeat(7001);
  const workerText = workerStamp(longContent, SOURCE_URL, null, "medium", ADAPTER);
  const coreContext = stampFreshness({
    raw: longContent,
    content_date: null,
    freshness_confidence: "medium",
  }, { url: SOURCE_URL }, ADAPTER);
  const coreText = formatForLLM(coreContext);

  assert.match(workerText, /Published: unknown/);
  assert.match(coreText, /Publish date: unknown/);
  assert.equal(parseWorkerEnvelope(workerText).content.length, 6000);
  assert.equal(coreContext.content.length, 7001);
});

test("Worker/Core parity helpers do not mutate caller-owned inputs", () => {
  const raw = "Immutable body";
  const result = {
    raw,
    content_date: CONTENT_DATE,
    freshness_confidence: "high" as const,
  };
  const before = { ...result };

  workerStamp(raw, SOURCE_URL, CONTENT_DATE, "high", ADAPTER);
  stampFreshness(result, { url: SOURCE_URL, maxLength: 8000 }, ADAPTER);

  assert.equal(raw, "Immutable body");
  assert.deepEqual(result, before);
});
