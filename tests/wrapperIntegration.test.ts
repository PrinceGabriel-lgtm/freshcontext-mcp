import test, { describe, before } from "node:test";
import assert from "node:assert/strict";
import { evaluateContextInput } from "../src/tools/evaluateContext.js";
import { toReadableContextResult } from "../src/core/index.js";
import { enforceEvaluateContext } from "../wrapper/src/fromEvaluateContext.ts";

// Proves the Pass 24 enforcement wrapper works on REAL Core output — not hand-built mocks.
// Runs a real evaluate_context over a mix of signals, maps each item to the exact shape the
// deployed tool emits in its [FRESHCONTEXT_EVALUATION_JSON] results[] (decision + readable +
// provenance_readiness), then enforces. This is the seam that would break if Core moved the
// handoff flag or the provenance state — the adapter reads them at those paths.

const NOW = "2026-07-08T00:00:00.000Z";

// A strong, recent, well-provenanced academic signal -> handoff-safe (admitted).
const STRONG = {
  id: "wrap-strong-1",
  source: "https://arxiv.org/abs/2606.strongwrap1",
  source_type: "arxiv" as const,
  title: "A strong, recent, citable result",
  content: "This is a strong recent result with clear provenance for the enforcement wrapper integration test.",
  published_at: "2026-06-28T00:00:00.000Z",
  retrieved_at: NOW,
  semantic_score: 0.96,
  date_confidence: "high" as const,
};

// A failed signal -> Core returns `exclude` -> not handoff-safe -> the wrapper drops it.
const FAILED = {
  id: "wrap-failed-1",
  source: "https://arxiv.org/abs/2606.failedwrap1",
  source_type: "arxiv" as const,
  title: "A failed retrieval",
  content: "[ERROR] upstream timeout while fetching this source",
  published_at: "2026-06-01T00:00:00.000Z",
  retrieved_at: NOW,
  semantic_score: 0.1,
  date_confidence: "unknown" as const,
  status: "failed" as const,
};

// Map an EvaluateContextResult into the deployed tool's structured results[] shape (the
// fields the adapter reads, plus source/title for identification, as the real tool emits).
function toStructuredResults(result: ReturnType<typeof evaluateContextInput>) {
  return result.items.map((item) => ({
    source: item.evaluation.signal.source,
    title: item.evaluation.signal.title,
    decision: item.decision.decision,
    readable: toReadableContextResult(item.evaluation, item.decision),
    provenance_readiness: item.evaluation.provenance_readiness,
  }));
}

describe("Pass 24 wrapper — enforce on real evaluate_context output", () => {
  let results: ReturnType<typeof toStructuredResults>;

  before(() => {
    const evaluated = evaluateContextInput({
      profile: "academic_research",
      intent: "citation_check",
      signals: [STRONG, FAILED],
      now: NOW,
    });
    results = toStructuredResults(evaluated);
  });

  test("the adapter reads decision + handoff + provenance from the real shape", () => {
    // If these are undefined the wrapper's adapter is reading the wrong paths.
    for (const r of results) {
      assert.ok(typeof r.decision === "string", "each result must carry a decision");
      assert.equal(typeof r.readable.handoff.safe_for_agent_handoff, "boolean");
      assert.ok(typeof r.provenance_readiness.state === "string");
    }
  });

  test("nothing is lost — admitted + demoted + dropped == input count", () => {
    const enforced = enforceEvaluateContext(results);
    assert.equal(
      enforced.admitted.length + enforced.demoted.length + enforced.dropped.length,
      results.length
    );
    assert.equal(enforced.summary.total, results.length);
  });

  test("the failed signal is dropped with a reason; every admitted item is handoff-safe", () => {
    const enforced = enforceEvaluateContext(results);
    // The failed signal -> exclude -> dropped.
    assert.ok(
      enforced.dropped.some((d) => d.item.decision === "exclude"),
      "a status:failed signal should be excluded and therefore dropped"
    );
    for (const d of enforced.dropped) assert.ok(d.reason.length > 0);
    // No admitted item may carry a false handoff flag.
    for (const a of enforced.admitted) {
      assert.notEqual(a.safe_for_agent_handoff, false);
    }
  });

  test("the strong signal survives (admitted or demoted, not dropped)", () => {
    const enforced = enforceEvaluateContext(results);
    const strongDropped = enforced.dropped.some((d) => d.item.source === STRONG.source);
    assert.equal(strongDropped, false, "a strong, recent, well-provenanced signal must not be dropped");
  });
});
