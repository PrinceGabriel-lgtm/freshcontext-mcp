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
const STRUCTURED_RESULT_KEYS = [
  "action",
  "confidence",
  "decision",
  "freshness_score",
  "index",
  "label",
  "meaning",
  "provenance_readiness",
  "rank_score",
  "readable",
  "reasons",
  "source",
  "source_type",
  "title",
  "utility_score",
  "warnings",
  "why",
];
const READABLE_KEYS = [
  "action",
  "handoff",
  "label",
  "summary",
  "warnings",
  "why",
];
const HANDOFF_KEYS = [
  "reason",
  "safe_for_agent_handoff",
];
const PROVENANCE_READINESS_KEYS = [
  "canonical_content_sha256",
  "ha_pri_v2",
  "published_at",
  "reasons",
  "retrieved_at",
  "semantic_fingerprint_sha256",
  "source_identity",
  "source_type",
  "state",
  "timing_completeness",
  "timing_confidence",
  "warnings",
];
const SOURCE_IDENTITY_KEYS = [
  "completeness",
  "result_id",
  "source",
  "source_type",
];

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

function assertNumberOrNull(value: unknown, field: string): void {
  assert.ok(value === null || typeof value === "number", `${field} should be numeric or null`);
}

function assertStringOrNull(value: unknown, field: string): void {
  assert.ok(value === null || typeof value === "string", `${field} should be a string or null`);
}

function assertStructuredResultContract(result: Record<string, unknown>): void {
  assert.deepEqual(Object.keys(result).sort(), STRUCTURED_RESULT_KEYS);
  assert.ok(Array.isArray(result.warnings));
  assert.ok(Array.isArray(result.reasons));
  assertNumberOrNull(result.freshness_score, "freshness_score");
  assert.equal(typeof result.rank_score, "number");
  assert.equal(typeof result.utility_score, "number");
  assert.equal(typeof result.why, "string");

  const readable = result.readable as Record<string, unknown>;
  assert.deepEqual(Object.keys(readable).sort(), READABLE_KEYS);
  assert.ok(Array.isArray(readable.why));
  assert.ok(Array.isArray(readable.warnings));
  const handoff = readable.handoff as Record<string, unknown>;
  assert.deepEqual(Object.keys(handoff).sort(), HANDOFF_KEYS);
  assert.equal(typeof handoff.safe_for_agent_handoff, "boolean");
  assert.equal(typeof handoff.reason, "string");

  const readiness = result.provenance_readiness as Record<string, unknown>;
  assert.deepEqual(Object.keys(readiness).sort(), PROVENANCE_READINESS_KEYS);
  assert.ok(Array.isArray(readiness.warnings));
  assert.ok(Array.isArray(readiness.reasons));
  assertStringOrNull(readiness.canonical_content_sha256, "canonical_content_sha256");
  assertStringOrNull(readiness.semantic_fingerprint_sha256, "semantic_fingerprint_sha256");

  const sourceIdentity = readiness.source_identity as Record<string, unknown>;
  assert.deepEqual(Object.keys(sourceIdentity).sort(), SOURCE_IDENTITY_KEYS);
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
  assert.deepEqual(Object.keys(structured).sort(), ["intent", "profile", "results"]);
  assert.ok(Array.isArray(structured.results));
  const first = structured.results[0];

  assert.equal(first.decision, "cite_as_primary");
  assertStructuredResultContract(first);
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

  assert.equal("handoff" in first, false);
  assert.equal(first.readable.label, "Primary source");
  assert.notEqual(first.readable.label, first.label);
  assert.equal(first.readable.why.length <= 5, true);
  assert.ok(Array.isArray(first.readable.warnings));
  assert.deepEqual(first.readable.handoff, {
    safe_for_agent_handoff: true,
    reason: "Decision and complete provenance support agent handoff.",
  });
});

test("evaluate_context accepts pre-provenance payloads and adds readiness without changing old fields", () => {
  const result = evaluateContextInput(validInput({
    signals: [
      {
        title: "Old complete source",
        content: "A pre-provenance caller sends ordinary source fields only.",
        source: "https://arxiv.org/abs/2605.12345",
        source_type: "arxiv",
        published_at: "2026-05-24T12:00:00.000Z",
        retrieved_at: NOW,
        semantic_score: 0.94,
      },
      {
        title: "Old undated source",
        content: "A useful source with unknown timing from an older caller shape.",
        source: "https://example.com/undated",
        source_type: "google_scholar",
        published_at: null,
        retrieved_at: NOW,
        semantic_score: 0.62,
        date_confidence: "unknown",
      },
      {
        title: "Old metadata-free source",
        content: "A caller omits optional metadata and provenance-only material.",
        source: "https://example.com/metadata-free",
        source_type: "arxiv",
        published_at: "2026-05-24T10:00:00.000Z",
        retrieved_at: NOW,
        semantic_score: 0.7,
      },
    ],
  }));
  const text = formatEvaluateContextResult(result);
  const structured = structuredOutput(text);

  assert.equal(result.items.length, 3);
  assert.equal(structured.results.length, 3);
  assert.deepEqual(Object.keys(structured).sort(), ["intent", "profile", "results"]);
  assert.deepEqual(
    structured.results.map((item: Record<string, unknown>) => item.source),
    [
      "https://arxiv.org/abs/2605.12345",
      "https://example.com/metadata-free",
      "https://example.com/undated",
    ]
  );

  for (const item of result.items) {
    assert.deepEqual(item.evaluation.signal.metadata, {});
    assert.ok(item.evaluation.provenance_readiness);
  }
  for (const item of structured.results) {
    assertStructuredResultContract(item);
    assert.ok(item.provenance_readiness);
    assert.ok(Array.isArray(item.warnings));
    assert.ok(Array.isArray(item.reasons));
  }

  const undated = structured.results.find(
    (item: Record<string, unknown>) => item.source === "https://example.com/undated"
  );
  assert.ok(undated);
  assert.equal(undated.freshness_score, null);
  assert.equal(undated.provenance_readiness.state, "partial");
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

test("evaluate_context remains caller-provided signal judgment without adapter orchestration", () => {
  const source = readFileSync("src/tools/evaluateContext.ts", "utf8");

  assert.match(source, /evaluateSignals/);
  assert.match(source, /interpretEvaluations/);
  assert.doesNotMatch(source, /adapters\/registry|\.\.\/adapters|getAdapterDescriptor|listAdapterDescriptors/);
  assert.doesNotMatch(source, /extract_[a-z_]+|search_jobs|search_repos|package_trends/);
});

test("evaluate_context helper does not import host runtime or retrieval modules", () => {
  const source = readFileSync("src/tools/evaluateContext.ts", "utf8");

  assert.doesNotMatch(source, /fetch\(|readFile|readdir|createServer|listen\(/);
  assert.doesNotMatch(source, /McpServer|WebStandardStreamableHTTPServerTransport|worker\/src|\.\.\/worker/);
  assert.doesNotMatch(source, /\bD1\b|\bKV\b|\bCACHE\b|retrieve\(|Operator/);
});
