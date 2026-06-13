import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const builtCorePath = fileURLToPath(new URL("../dist/core/index.js", import.meta.url));

test("package exposes the Core subpath without changing the MCP root", () => {
  assert.equal(packageJson.main, "dist/server.js");
  assert.equal(packageJson.bin["freshcontext-mcp"], "dist/server.js");
  assert.equal(packageJson.exports["."].import, "./dist/server.js");
  assert.equal(packageJson.exports["./core"].import, "./dist/core/index.js");
  assert.equal(packageJson.exports["./core"].types, "./dist/core/index.d.ts");
});

test(
  "freshcontext-mcp/core imports the built Core engine",
  { skip: !existsSync(builtCorePath) },
  async () => {
    const core = await import("freshcontext-mcp/core");
    const expectedFunctions = [
      "normalizeSignal",
      "evaluateSignal",
      "evaluateSignals",
      "interpretEvaluation",
      "interpretEvaluations",
      "toReadableContextResult",
      "prepareProvenanceReadiness",
      "getSourceProfile",
      "calculateHaPriV2",
      "verifyHaPriV2",
    ];
    for (const name of expectedFunctions) {
      assert.equal(typeof core[name], "function", `${name} should remain exported`);
    }

    const profile = core.getSourceProfile("academic_research");
    assert.equal(profile?.profile_id, "academic_research");

    const evaluations = core.evaluateSignals(
      [
        {
          title: "Recent paper",
          content: "A current source with clear provenance.",
          source: "https://example.com/paper",
          source_type: "arxiv",
          published_at: "2026-06-01T00:00:00.000Z",
          retrieved_at: "2026-06-09T00:00:00.000Z",
          semantic_score: 0.92,
        },
      ],
      { now: "2026-06-09T00:00:00.000Z" }
    );
    const decisions = core.interpretEvaluations(evaluations, {
      sourceProfile: profile,
      intentProfile: "citation_check",
    });

    assert.equal(evaluations.length, 1);
    assert.equal(evaluations[0].provenance_readiness.state, "complete");
    assert.equal(decisions.length, 1);
    const readable = core.toReadableContextResult(evaluations[0], decisions[0]);
    assert.equal(typeof readable.summary, "string");
    assert.ok(["cite_as_primary", "use_first", "cite_as_supporting"].includes(decisions[0].decision));

    const haPriInput = {
      resultId: "subpath-contract",
      rawContent: "Subpath provenance contract content",
      semanticFingerprint: "subpath-contract-fingerprint",
      adapter: "arxiv",
      publishedAt: "2026-06-01T00:00:00.000Z",
      retrievedAt: "2026-06-09T00:00:00.000Z",
      engineVersion: "freshcontext-0.3.20",
    };
    const signature = core.calculateHaPriV2(haPriInput);
    assert.equal(core.verifyHaPriV2(haPriInput, signature.haPriSigV2).status, "valid");
  }
);
