import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  EvaluateContextInputError,
  evaluateContextInput,
  formatEvaluateContextResult,
} from "../src/tools/evaluateContext.js";

const NOW = "2026-05-24T13:00:00.000Z";
const JSON_START = "[FRESHCONTEXT_EVALUATION_JSON]";
const JSON_END = "[/FRESHCONTEXT_EVALUATION_JSON]";

function validInput(overrides: Record<string, unknown> = {}) {
  return {
    profile: "academic_research",
    intent: "citation_check",
    now: NOW,
    signals: [
      {
        title: "Fresh research source",
        content: "A relevant academic source with a reliable publication date.",
        source: "https://arxiv.org/abs/2605.12345",
        source_type: "arxiv",
        published_at: "2026-05-24T12:00:00.000Z",
        retrieved_at: NOW,
        semantic_score: 0.94,
        date_confidence: "high",
      },
    ],
    ...overrides,
  };
}

function structuredOutput(text: string) {
  const start = text.indexOf(JSON_START);
  const end = text.indexOf(JSON_END);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  return JSON.parse(text.slice(start + JSON_START.length, end).trim());
}

test("evaluate_context returns decision-first output for caller-provided signals", () => {
  const result = evaluateContextInput(validInput());
  const text = formatEvaluateContextResult(result);

  assert.equal(result.profile.profile_id, "academic_research");
  assert.equal(result.intent, "citation_check");
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].decision.decision, "cite_as_primary");
  assert.match(text, /Decision: Cite as primary/);
  assert.match(text, /Meaning:/);
  assert.match(text, /Action:/);
  assert.match(text, /Warnings:/);
  assert.match(text, /Freshness:/);
  assert.match(text, /Rank score:/);
  assert.match(text, /Utility:/);
  assert.match(text, /Confidence:/);
  assert.match(text, /Why:/);
  assert.match(text, /\[FRESHCONTEXT_EVALUATION_JSON\]/);
});

test("evaluate_context structured JSON includes additive readable output", () => {
  const result = evaluateContextInput(validInput());
  const text = formatEvaluateContextResult(result);
  const structured = structuredOutput(text);
  const first = structured.results[0];

  assert.equal(first.decision, "cite_as_primary");
  assert.equal(first.label, "Cite as primary");
  assert.equal(first.meaning, result.items[0].decision.meaning);
  assert.equal(first.action, result.items[0].decision.action);
  assert.ok(Array.isArray(first.warnings));
  assert.ok(Array.isArray(first.reasons));
  assert.equal(typeof first.freshness_score, "number");
  assert.equal(typeof first.rank_score, "number");
  assert.equal(typeof first.utility_score, "number");
  assert.equal(first.confidence, "high");
  assert.equal(typeof first.why, "string");
  assert.equal(first.provenance_readiness.state, "complete");
  assert.equal(first.provenance_readiness.source_identity.completeness, "complete");
  assert.match(first.provenance_readiness.canonical_content_sha256, /^[a-f0-9]{64}$/);

  assert.deepEqual(Object.keys(first.readable).sort(), [
    "action",
    "label",
    "summary",
    "warnings",
    "why",
  ]);
  assert.equal(first.readable.label, "Primary source");
  assert.notEqual(first.readable.label, first.label);
  assert.equal(first.readable.why.length <= 5, true);
  assert.ok(Array.isArray(first.readable.warnings));
});

test("evaluate_context rejects unknown source profiles", () => {
  assert.throws(
    () => evaluateContextInput(validInput({ profile: "unknown_profile" })),
    (error) => error instanceof EvaluateContextInputError
      && /Unknown source profile/.test(error.message)
  );
});

test("evaluate_context rejects unsupported intent profiles", () => {
  assert.throws(
    () => evaluateContextInput(validInput({ intent: "write_me_a_trade" })),
    (error) => error instanceof EvaluateContextInputError
      && /Unsupported intent profile/.test(error.message)
  );
});

test("evaluate_context rejects missing or non-array signals", () => {
  assert.throws(
    () => evaluateContextInput(validInput({ signals: undefined })),
    /signals must be an array/
  );
  assert.throws(
    () => evaluateContextInput(validInput({ signals: { source: "https://example.com" } })),
    /signals must be an array/
  );
});

test("evaluate_context rejects empty signal arrays", () => {
  assert.throws(
    () => evaluateContextInput(validInput({ signals: [] })),
    /at least one candidate context item/
  );
});

test("evaluate_context rejects oversized batches and fields", () => {
  assert.throws(
    () => evaluateContextInput(validInput({
      signals: Array.from({ length: 101 }, (_, index) => ({
        title: `Source ${index}`,
        content: "Candidate context.",
        source: `https://example.com/${index}`,
      })),
    })),
    /at most 100 candidate context items/
  );

  assert.throws(
    () => evaluateContextInput(validInput({
      signals: [
        {
          title: "Oversized source",
          content: "Candidate context.",
          source: `https://example.com/${"a".repeat(2050)}`,
        },
      ],
    })),
    /source exceeds maximum length/
  );

  assert.throws(
    () => evaluateContextInput(validInput({ now: "not-a-date" })),
    /now must be a valid timestamp/
  );
});

test("evaluate_context surfaces missing-date signals as needs verification", () => {
  const result = evaluateContextInput(validInput({
    signals: [
      {
        title: "Undated useful source",
        content: "This source has useful content but no reliable date.",
        source: "https://example.com/undated",
        source_type: "arxiv",
        published_at: null,
        retrieved_at: NOW,
        semantic_score: 0.62,
        date_confidence: "unknown",
      },
    ],
  }));

  assert.equal(result.items[0].decision.decision, "needs_verification");
  assert.equal(result.items[0].evaluation.freshness_score, null);
});

test("evaluate_context excludes failed or error-looking signals", () => {
  const result = evaluateContextInput(validInput({
    signals: [
      {
        title: "Blocked source",
        content: "[ERROR] upstream blocked the request",
        source: "https://example.com/blocked",
        source_type: "arxiv",
        published_at: "2026-05-24T12:00:00.000Z",
        retrieved_at: NOW,
        semantic_score: 0.99,
      },
    ],
  }));

  assert.equal(result.items[0].decision.decision, "exclude");
  assert.equal(result.items[0].evaluation.signal.status, "failed");
});

test("evaluate_context requires each signal to carry source plus title or content", () => {
  assert.throws(
    () => evaluateContextInput(validInput({
      signals: [{ title: "Missing source", content: "No source here." }],
    })),
    /source must be a non-empty string/
  );
  assert.throws(
    () => evaluateContextInput(validInput({
      signals: [{ source: "https://example.com/no-content" }],
    })),
    /must include title or content/
  );
});

test("evaluate_context helper does not import host runtime or retrieval modules", () => {
  const source = readFileSync("src/tools/evaluateContext.ts", "utf8");

  assert.doesNotMatch(source, /fetch\(|readFile|readdir|createServer|listen\(/);
  assert.doesNotMatch(source, /McpServer|WebStandardStreamableHTTPServerTransport|worker\/src|\.\.\/worker/);
  assert.doesNotMatch(source, /\bD1\b|\bKV\b|\bCACHE\b|retrieve\(|Operator/);
});
