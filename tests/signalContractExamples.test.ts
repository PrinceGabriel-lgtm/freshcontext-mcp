import test from "node:test";
import assert from "node:assert/strict";
import {
  SIGNAL_CONTRACT_VERSION,
  normalizeSignal,
} from "../src/core/index.js";
import type { FreshContextSignalInput } from "../src/core/index.js";

const RETRIEVED_AT = "2026-06-09T12:00:00.000Z";

const validExamples: FreshContextSignalInput[] = [
  {
    title: "A fresh retrieval-augmented generation benchmark",
    content: "The paper reports a 2026 benchmark for retrieval-augmented generation systems.",
    source: "https://arxiv.org/abs/2606.00001",
    source_type: "arxiv",
    published_at: "2026-06-01T09:00:00.000Z",
    retrieved_at: RETRIEVED_AT,
    semantic_score: 0.94,
    metadata: { profile: "academic_research" },
  },
  {
    title: "API changelog",
    content: "The official changelog documents the current API behavior.",
    source: "https://docs.example.com/changelog",
    source_type: "official_docs",
    published_at: "2026-06-08T10:00:00.000Z",
    retrieved_at: RETRIEVED_AT,
    semantic_score: 0.88,
  },
  {
    title: "AI tools engineer",
    content: "A current remote role for an AI tools engineer.",
    source: "https://jobs.example.com/ai-tools-engineer",
    source_type: "jobs",
    published_at: "2026-06-07T08:00:00.000Z",
    retrieved_at: RETRIEVED_AT,
    semantic_score: 0.86,
  },
  {
    title: "Company quarterly update",
    content: "The company reported current quarter revenue and guidance.",
    source: "https://investors.example.com/q2-update",
    source_type: "finance",
    published_at: "2026-06-09T07:00:00.000Z",
    retrieved_at: RETRIEVED_AT,
    semantic_score: 0.83,
  },
  {
    title: "Developer discussion",
    content: "Developers are discussing setup friction and recent adoption.",
    source: "https://news.ycombinator.com/item?id=123456",
    source_type: "hackernews",
    published_at: "2026-06-09T11:00:00.000Z",
    retrieved_at: RETRIEVED_AT,
    semantic_score: 0.71,
  },
];

test("Signal Contract examples normalize valid candidate context", () => {
  for (const example of validExamples) {
    const signal = normalizeSignal(example);

    assert.equal(signal.contract_version, SIGNAL_CONTRACT_VERSION);
    assert.equal(signal.source, example.source);
    assert.equal(signal.source_type, example.source_type);
    assert.equal(signal.published_at, example.published_at);
    assert.equal(signal.retrieved_at, RETRIEVED_AT);
    assert.equal(signal.semantic_score, example.semantic_score);
    assert.equal(signal.status, "success");
    assert.notEqual(signal.date_confidence, "unknown");
  }
});

test("Signal Contract defaults source_type when caller omits it", () => {
  const signal = normalizeSignal({
    title: "Caller-provided context",
    content: "Useful context supplied by an external retriever.",
    source: "https://example.com/caller-context",
    published_at: "2026-06-09T10:00:00.000Z",
    retrieved_at: RETRIEVED_AT,
    semantic_score: 0.72,
  });

  assert.equal(signal.source_type, "default");
  assert.ok(signal.reasons.some((reason) => reason.includes("source_type was missing")));
});

test("Signal Contract clears missing, invalid, and future timestamps", () => {
  const missingDate = normalizeSignal({
    title: "Relevant source with no date",
    content: "Useful candidate context, but no publication timestamp is available.",
    source: "https://example.com/no-date",
    source_type: "official_docs",
    retrieved_at: RETRIEVED_AT,
    semantic_score: 0.78,
  });
  const invalidTimestamp = normalizeSignal({
    title: "Invalid date source",
    content: "Candidate context with malformed date metadata.",
    source: "https://example.com/bad-date",
    source_type: "official_docs",
    published_at: "not-a-date",
    retrieved_at: RETRIEVED_AT,
    semantic_score: 0.78,
  });
  const futureTimestamp = normalizeSignal({
    title: "Future-dated source",
    content: "Candidate context whose publication timestamp is after retrieval time.",
    source: "https://example.com/future-date",
    source_type: "official_docs",
    published_at: "2026-06-09T12:06:00.000Z",
    retrieved_at: RETRIEVED_AT,
    semantic_score: 0.78,
  });

  assert.equal(missingDate.published_at, null);
  assert.equal(missingDate.date_confidence, "unknown");
  assert.equal(invalidTimestamp.published_at, null);
  assert.equal(invalidTimestamp.date_confidence, "unknown");
  assert.ok(invalidTimestamp.reasons.some((reason) => reason.includes("invalid")));
  assert.equal(futureTimestamp.published_at, null);
  assert.equal(futureTimestamp.date_confidence, "unknown");
  assert.ok(futureTimestamp.reasons.some((reason) => reason.includes("future-dated")));
});

test("Signal Contract marks failed content and clamps semantic scores", () => {
  const failed = normalizeSignal({
    title: "Blocked source",
    content: "[Error] upstream timeout",
    source: "https://example.com/blocked",
    source_type: "official_docs",
    published_at: "2026-06-09T10:00:00.000Z",
    retrieved_at: RETRIEVED_AT,
    semantic_score: 0.91,
  });
  const tooHigh = normalizeSignal({
    title: "Overscored source",
    content: "Candidate context with an out-of-range relevance score.",
    source: "https://example.com/overscored",
    source_type: "official_docs",
    published_at: "2026-06-09T10:00:00.000Z",
    retrieved_at: RETRIEVED_AT,
    semantic_score: 1.7,
  });
  const tooLow = normalizeSignal({
    title: "Underscored source",
    content: "Candidate context with a negative relevance score.",
    source: "https://example.com/underscored",
    source_type: "official_docs",
    published_at: "2026-06-09T10:00:00.000Z",
    retrieved_at: RETRIEVED_AT,
    semantic_score: -0.4,
  });

  assert.equal(failed.status, "failed");
  assert.ok(failed.reasons.some((reason) => reason.includes("failed adapter output")));
  assert.equal(tooHigh.semantic_score, 1);
  assert.ok(tooHigh.reasons.some((reason) => reason.includes("exceeded 1")));
  assert.equal(tooLow.semantic_score, 0);
  assert.ok(tooLow.reasons.some((reason) => reason.includes("below 0")));
});

