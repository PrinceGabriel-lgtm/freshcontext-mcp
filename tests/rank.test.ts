import test from "node:test";
import assert from "node:assert/strict";
import {
  clampScore,
  explainSignal,
  rankSignal,
  rankSignals,
} from "../src/core/index.js";
import type { FreshSignal, RankedSignal, RankOptions } from "../src/core/index.js";

const now = "2026-05-13T10:00:00.000Z";
const options: RankOptions = { now, defaultSourceType: "hackernews" };

test("rankSignals ranks fresh relevant signals above stale comparable signals", () => {
  const signals: FreshSignal[] = [
    {
      id: "stale",
      source: "https://example.com/stale",
      source_type: "hackernews",
      published_at: "2026-05-01T10:00:00.000Z",
      semantic_score: 0.9,
      content: "Stale but relevant signal",
    },
    {
      id: "fresh",
      source: "https://example.com/fresh",
      source_type: "hackernews",
      published_at: "2026-05-13T09:00:00.000Z",
      semantic_score: 0.9,
      content: "Fresh and relevant signal",
    },
  ];

  const ranked = rankSignals(signals, options);

  assert.equal(ranked[0].id, "fresh");
  assert.equal(ranked[1].id, "stale");
  assert.ok(ranked[0].final_score > ranked[1].final_score);
});

test("missing date still ranks with lower confidence and missing-date reason", () => {
  const ranked = rankSignal({
    id: "missing-date",
    source: "https://example.com/missing",
    source_type: "blog",
    published_at: null,
    semantic_score: 0.8,
    content: "Relevant signal without date",
  }, { now, defaultSourceType: "blog" });

  assert.equal(ranked.freshness_score, null);
  assert.equal(ranked.confidence, "medium");
  assert.match(ranked.reason, /Missing freshness data/);
  assert.ok(ranked.final_score > 0);
  assert.ok(ranked.final_score < 0.8);
});

test("final_score and clampScore stay in the normalized 0..1 range", () => {
  assert.equal(clampScore(-1), 0);
  assert.equal(clampScore(2), 1);
  assert.equal(clampScore(Number.NaN), 0);

  const ranked = rankSignal({
    source: "https://example.com/clamped",
    source_type: "hackernews",
    published_at: "2026-05-13T09:00:00.000Z",
    semantic_score: 2,
    content: "Fresh signal with oversized semantic score",
  }, { now, semanticWeight: 10, freshnessWeight: 10 });

  assert.ok(ranked.final_score >= 0);
  assert.ok(ranked.final_score <= 1);
  assert.equal(ranked.semantic_score, 1);
});

test("rankSignals preserves input order when final scores tie", () => {
  const signals: FreshSignal[] = [
    {
      id: "first",
      source: "https://example.com/first",
      source_type: "github",
      published_at: "2026-05-13T09:00:00.000Z",
      semantic_score: 0.75,
      content: "First equivalent signal",
    },
    {
      id: "second",
      source: "https://example.com/second",
      source_type: "github",
      published_at: "2026-05-13T09:00:00.000Z",
      semantic_score: 0.75,
      content: "Second equivalent signal",
    },
  ];

  const ranked = rankSignals(signals, options);

  assert.equal(ranked[0].id, "first");
  assert.equal(ranked[1].id, "second");
});

test("explainSignal returns deterministic reasons for key signal states", () => {
  const fresh = rankSignal({
    source: "https://example.com/current",
    source_type: "hackernews",
    published_at: "2026-05-13T09:00:00.000Z",
    semantic_score: 0.9,
    content: "Current high relevance",
  }, options);
  const stale = rankSignal({
    source: "https://example.com/stale",
    source_type: "hackernews",
    published_at: "2026-05-01T10:00:00.000Z",
    semantic_score: 0.9,
    content: "Stale high relevance",
  }, options);
  const missing = rankSignal({
    source: "https://example.com/missing",
    source_type: "blog",
    published_at: null,
    semantic_score: 0.8,
    content: "Missing date",
  }, options);
  const weak = rankSignal({
    source: "https://example.com/weak",
    source_type: "hackernews",
    published_at: "2026-05-13T09:00:00.000Z",
    semantic_score: 0.2,
    content: "Fresh but weak",
  }, options);

  assert.equal(explainSignal(fresh), "Strong semantic match and current freshness for hackernews.");
  assert.equal(explainSignal(stale), "Relevant signal, but stale for hackernews.");
  assert.equal(explainSignal(missing), "Missing freshness data for blog; ranked mostly by semantic relevance.");
  assert.equal(explainSignal(weak), "Fresh signal from hackernews, but semantic relevance is weak.");
});

test("rankSignals does not mutate the original input array or signal objects", () => {
  const signals: FreshSignal[] = [
    {
      id: "original",
      source: "https://example.com/original",
      source_type: "hackernews",
      published_at: "2026-05-13T09:00:00.000Z",
      semantic_score: 0.9,
      content: "Original signal",
    },
  ];
  const snapshot = JSON.stringify(signals);

  rankSignals(signals, options);

  assert.equal(JSON.stringify(signals), snapshot);
  assert.equal(Object.hasOwn(signals[0], "final_score"), false);
});

test("rank/explain public exports are available from src/core/index.ts", () => {
  const ranked: RankedSignal = rankSignal({
    source: "https://example.com/exported",
    source_type: "hackernews",
    published_at: "2026-05-13T09:00:00.000Z",
    semantic_score: 0.9,
    content: "Exported API signal",
  }, options);

  assert.equal(typeof rankSignals, "function");
  assert.equal(typeof rankSignal, "function");
  assert.equal(typeof explainSignal, "function");
  assert.equal(typeof clampScore, "function");
  assert.equal(typeof ranked.reason, "string");
});
