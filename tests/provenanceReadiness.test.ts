import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateContextInput,
  formatEvaluateContextResult,
} from "../src/tools/evaluateContext.js";
import {
  evaluateSignal,
  prepareProvenanceReadiness,
} from "../src/core/index.js";
import type { FreshContextSignalInput } from "../src/core/index.js";

const NOW = "2026-05-24T13:00:00.000Z";
const JSON_START = "[FRESHCONTEXT_EVALUATION_JSON]";
const JSON_END = "[/FRESHCONTEXT_EVALUATION_JSON]";

function baseSignal(overrides: Partial<FreshContextSignalInput> = {}): FreshContextSignalInput {
  return {
    id: "sig_readiness",
    source: "https://example.com/readiness",
    source_type: "official_docs",
    title: "Provenance readiness source",
    content: "FreshContext provenance readiness content",
    published_at: "2026-05-24T12:00:00.000Z",
    retrieved_at: NOW,
    semantic_score: 0.91,
    date_confidence: "high",
    status: "success",
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

test("prepareProvenanceReadiness classifies complete provenance", () => {
  const readiness = prepareProvenanceReadiness(baseSignal(), {
    resultId: "sig_readiness",
    semanticFingerprint: "readiness-fingerprint",
    engineVersion: "freshcontext-0.3.20",
    now: NOW,
  });

  assert.equal(readiness.state, "complete");
  assert.equal(readiness.source_identity.completeness, "complete");
  assert.equal(readiness.source_identity.result_id, "sig_readiness");
  assert.equal(readiness.timing_completeness, "complete");
  assert.equal(readiness.timing_confidence, "high");
  assert.match(readiness.canonical_content_sha256 ?? "", /^[a-f0-9]{64}$/);
  assert.match(readiness.semantic_fingerprint_sha256 ?? "", /^[a-f0-9]{64}$/);
  assert.ok(readiness.ha_pri_v2);
  assert.equal(readiness.ha_pri_v2.resultId, "sig_readiness");
});

test("prepareProvenanceReadiness classifies missing published_at as partial", () => {
  const readiness = prepareProvenanceReadiness(baseSignal({
    published_at: null,
    date_confidence: "unknown",
  }), { now: NOW });

  assert.equal(readiness.state, "partial");
  assert.equal(readiness.published_at, null);
  assert.equal(readiness.timing_completeness, "partial");
  assert.ok(readiness.warnings.some((warning) => warning.includes("published_at")));
  assert.ok(readiness.warnings.some((warning) => warning.includes("timing confidence")));
});

test("prepareProvenanceReadiness distinguishes missing and unusable source identity", () => {
  const missing = prepareProvenanceReadiness({
    ...baseSignal(),
    source: "",
  } as FreshContextSignalInput, { now: NOW });
  const unusable = prepareProvenanceReadiness(baseSignal({
    source: "unknown",
  }), { now: NOW });

  assert.equal(missing.state, "incomplete");
  assert.equal(missing.source_identity.completeness, "missing");
  assert.ok(missing.warnings.some((warning) => warning.includes("source identity is missing")));

  assert.equal(unusable.state, "unknown");
  assert.equal(unusable.source_identity.completeness, "unusable");
  assert.ok(unusable.warnings.some((warning) => warning.includes("source identity is unusable")));
});

test("prepareProvenanceReadiness handles minimal legacy input without provenance fields", () => {
  const readiness = prepareProvenanceReadiness({
    source: "https://example.com/minimal-legacy",
    title: "Minimal legacy source",
  }, { now: NOW });

  assert.equal(readiness.state, "incomplete");
  assert.equal(readiness.source_identity.completeness, "complete");
  assert.equal(readiness.source_type, "default");
  assert.equal(readiness.published_at, null);
  assert.equal(readiness.canonical_content_sha256, null);
  assert.ok(readiness.warnings.some((warning) => warning.includes("source_type")));
  assert.ok(readiness.warnings.some((warning) => warning.includes("published_at")));
  assert.ok(readiness.warnings.some((warning) => warning.includes("canonical content hash")));
});

test("prepareProvenanceReadiness does not let conflicting identity material rescue unusable source", () => {
  const readiness = prepareProvenanceReadiness(baseSignal({
    id: undefined,
    source: "unknown",
    metadata: {
      result_id: "metadata-result-id",
      source_id: "conflicting-source-id",
    },
  }), { now: NOW });

  assert.equal(readiness.state, "unknown");
  assert.equal(readiness.source_identity.completeness, "unusable");
  assert.equal(readiness.source_identity.result_id, "metadata-result-id");
  assert.ok(readiness.warnings.some((warning) => warning.includes("source identity is unusable")));
});

test("prepareProvenanceReadiness returns unknown for failed or error-looking content", () => {
  const readiness = prepareProvenanceReadiness(baseSignal({
    content: "[ERROR] upstream timeout",
  }), { now: NOW });

  assert.equal(readiness.state, "unknown");
  assert.ok(readiness.warnings.some((warning) => warning.includes("failed context")));
  assert.ok(readiness.reasons.some((reason) => reason.includes("failed adapter output")));
  assert.equal(readiness.ha_pri_v2, null);
});

test("prepareProvenanceReadiness marks copied, local, or secondary material as derived", () => {
  const readiness = prepareProvenanceReadiness(baseSignal({
    source_type: "secondary",
    metadata: {
      original_source: "https://example.com/original",
    },
  }), { now: NOW });

  assert.equal(readiness.state, "derived");
  assert.equal(readiness.source_type, "secondary");
  assert.ok(readiness.warnings.some((warning) => warning.includes("derived")));
});

test("prepareProvenanceReadiness keeps future timestamps visible", () => {
  const readiness = prepareProvenanceReadiness(baseSignal({
    published_at: "2026-05-24T13:06:00.000Z",
    date_confidence: "high",
  }), { now: NOW });

  assert.equal(readiness.state, "partial");
  assert.equal(readiness.published_at, null);
  assert.equal(readiness.timing_confidence, "unknown");
  assert.ok(readiness.reasons.some((reason) => reason.includes("future-dated")));
  assert.ok(readiness.warnings.some((warning) => warning.includes("published_at")));
});

test("prepareProvenanceReadiness is deterministic when Ha-Pri v2 material is possible", () => {
  const options = {
    resultId: "sig_readiness",
    semanticFingerprint: "readiness-fingerprint",
    engineVersion: "freshcontext-0.3.20",
    now: NOW,
  };
  const first = prepareProvenanceReadiness(baseSignal(), options);
  const second = prepareProvenanceReadiness(baseSignal(), options);

  assert.deepEqual(first, second);
  assert.ok(first.ha_pri_v2);
  assert.equal(first.ha_pri_v2.haPriSigV2, second.ha_pri_v2?.haPriSigV2);
});

test("evaluateSignal includes additive provenance_readiness without changing rank or utility", () => {
  const result = evaluateSignal(baseSignal(), { now: NOW });

  assert.equal(result.provenance_readiness.state, "complete");
  assert.equal(typeof result.ranked.final_score, "number");
  assert.equal(typeof result.utility.score, "number");
});

test("evaluate_context structured JSON includes additive provenance_readiness", () => {
  const result = evaluateContextInput({
    profile: "official_docs",
    intent: "developer_adoption",
    now: NOW,
    signals: [baseSignal()],
  });
  const text = formatEvaluateContextResult(result);
  const structured = structuredOutput(text);
  const first = structured.results[0];

  assert.equal(first.source, "https://example.com/readiness");
  assert.equal(typeof first.rank_score, "number");
  assert.equal(first.provenance_readiness.state, "complete");
  assert.equal(first.provenance_readiness.source_identity.completeness, "complete");
  assert.equal(first.readable.label.length > 0, true);
});
