import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { searchArxivSignals } from "../src/adapters/arxiv.js";
import { evaluateSignals } from "../src/core/pipeline.js";
import { interpretEvaluations } from "../src/core/decision.js";
import { getSourceProfile } from "../src/core/sourceProfiles.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = resolve(__dirname, "../examples/fixtures/arxiv-sample.xml");
const FIXTURE_XML = readFileSync(FIXTURE_PATH, "utf8");
const NOW = "2026-06-02T12:00:00.000Z";

function installArxivFixtureFetch(): () => void {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => new Response(FIXTURE_XML, {
    status: 200,
    headers: { "Content-Type": "application/atom+xml" },
  });

  return () => {
    globalThis.fetch = originalFetch;
  };
}

test("arXiv signal extraction feeds Core evaluation and decision helper", async () => {
  const restoreFetch = installArxivFixtureFetch();

  try {
    const sourceProfile = getSourceProfile("academic_research");
    assert.ok(sourceProfile);

    const signals = await searchArxivSignals({
      query: "freshness-ranked context selection",
      retrievedAt: NOW,
      semanticScore: 0.96,
    });
    const evaluations = evaluateSignals(signals, {
      now: NOW,
      defaultSourceType: "arxiv",
    });
    const decisions = interpretEvaluations(evaluations, {
      sourceProfile,
      intentProfile: "citation_check",
    });

    assert.equal(signals.length, 2);
    assert.equal(evaluations.length, 2);
    assert.equal(decisions.length, 2);

    assert.equal(evaluations[0].signal.title, "FreshContext temporal retrieval benchmark");
    assert.equal(evaluations[0].signal.source_type, "arxiv");
    assert.equal(evaluations[0].signal.published_at, "2026-05-25T12:00:00.000Z");
    assert.ok((evaluations[0].freshness_score ?? 0) >= 90);
    assert.ok(evaluations[0].ranked.final_score >= 0.85);
    assert.ok(evaluations[0].utility.score >= 60);

    assert.equal(decisions[0].decision, "cite_as_primary");
    assert.match(decisions[0].meaning, /main evidence/i);
    assert.match(decisions[0].action, /primary citation evidence/i);
    assert.ok(decisions[0].warnings.some((warning) => /does not certify truth/i.test(warning)));

    assert.equal(evaluations[1].signal.title, "Information aging in retrieval augmented systems");
    assert.equal(decisions[1].decision, "cite_as_supporting");
    assert.ok(decisions[1].warnings.some((warning) => /does not certify truth/i.test(warning)));
  } finally {
    restoreFetch();
  }
});

test("arXiv decision proof does not require MCP server behavior", async () => {
  const source = readFileSync(resolve(__dirname, "../src/server.ts"), "utf8");

  assert.match(source, /arxivAdapter/);
  assert.doesNotMatch(source, /searchArxivSignals/);
});
