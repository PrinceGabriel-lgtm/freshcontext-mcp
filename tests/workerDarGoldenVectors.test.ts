import test from "node:test";
import assert from "node:assert/strict";
// worker/package.json has no "type": "module", so tsx loads worker .ts files
// with CJS interop. Default-import + destructure, mirroring
// tests/workerCoreLambdaParity.test.ts and tests/workerCoreEnvelopeParity.test.ts.
import workerIntelligence from "../worker/src/intelligence.ts";

const { applyDecay, LAMBDA } = workerIntelligence as {
  applyDecay: (
    baseScore: number,
    publishedAt: string | null,
    adapter: string
  ) => { rt: number; entropy: string; is_expired: boolean };
  LAMBDA: Record<string, number>;
};

// Pass 20-C behavior-equivalence proof.
//
// These EXPECTED vectors were captured by running the PRE-migration Worker
// applyDecay (when worker/src/intelligence.ts still defined its own LAMBDA
// table) with the clock frozen, across all 22 adapter keys, at a fixed
// published_at + fixed base score. They are NOT computed from Core and NOT
// hand-derived — they are the literal output of the Worker before the import
// swap. After 20-C points LAMBDA at core/edge, applyDecay MUST still produce
// these byte-identical values. Any drift fails this test.
//
// Inputs (must match the capture exactly):
const FIXED_NOW = Date.parse("2026-06-08T00:00:00.000Z"); // exactly 168h after PUBLISHED
const PUBLISHED = "2026-06-01T00:00:00.000Z";
const BASE = 80;

const EXPECTED: Record<string, { rt: number; entropy: string; is_expired: boolean }> = {
  arxiv:             { rt: 79.3, entropy: "low",    is_expired: false },
  changelog:         { rt: 73.6, entropy: "low",    is_expired: false },
  company_landscape: { rt: 34.5, entropy: "stable", is_expired: false },
  default:           { rt: 67.6, entropy: "low",    is_expired: false },
  finance:           { rt: 67.6, entropy: "low",    is_expired: false },
  finance_landscape: { rt: 67.6, entropy: "low",    is_expired: false },
  gdelt:             { rt: 2.8,  entropy: "high",   is_expired: true  },
  gebiz:             { rt: 48.3, entropy: "stable", is_expired: false },
  github:            { rt: 77.4, entropy: "low",    is_expired: false },
  google_scholar:    { rt: 79.3, entropy: "low",    is_expired: false },
  gov_landscape:     { rt: 67.6, entropy: "low",    is_expired: false },
  govcontracts:      { rt: 67.6, entropy: "low",    is_expired: false },
  hackernews:        { rt: 0,    entropy: "high",   is_expired: true  },
  idea_landscape:    { rt: 0,    entropy: "high",   is_expired: true  },
  jobs:              { rt: 34.5, entropy: "stable", is_expired: false },
  landscape:         { rt: 0,    entropy: "high",   is_expired: true  },
  packagetrends:     { rt: 73.6, entropy: "low",    is_expired: false },
  producthunt:       { rt: 14.9, entropy: "high",   is_expired: false },
  reddit:            { rt: 14.9, entropy: "high",   is_expired: false },
  reposearch:        { rt: 77.4, entropy: "low",    is_expired: false },
  sec_filings:       { rt: 34.5, entropy: "stable", is_expired: false },
  yc:                { rt: 67.6, entropy: "low",    is_expired: false },
};

test("worker applyDecay matches pre-migration golden vectors for all 22 adapters", () => {
  // Freeze the clock so applyDecay's internal Date.now() is deterministic and
  // the age (t) is exactly 168h for every adapter — isolating per-adapter λ.
  const realNow = Date.now;
  Date.now = () => FIXED_NOW;
  try {
    const adapters = Object.keys(LAMBDA).sort();
    assert.equal(adapters.length, 22, "Worker LAMBDA must expose 22 adapter keys");
    assert.equal(Object.keys(EXPECTED).length, 22, "EXPECTED must cover all 22 adapters");

    for (const adapter of adapters) {
      const actual = applyDecay(BASE, PUBLISHED, adapter);
      assert.deepEqual(
        actual,
        EXPECTED[adapter],
        `applyDecay drift for adapter "${adapter}": ` +
          `got ${JSON.stringify(actual)}, expected ${JSON.stringify(EXPECTED[adapter])}`
      );
    }
  } finally {
    Date.now = realNow;
  }
});

test("golden vectors exercise all three entropy bands and both expiry states", () => {
  // Guards the guard: if a future edit collapsed the scenario (e.g. all-null
  // dates), the vectors would stop discriminating λ. Assert real spread.
  const bands = new Set(Object.values(EXPECTED).map((v) => v.entropy));
  assert.ok(bands.has("low") && bands.has("stable") && bands.has("high"), "all entropy bands present");
  const expiries = new Set(Object.values(EXPECTED).map((v) => v.is_expired));
  assert.ok(expiries.has(true) && expiries.has(false), "both expiry states present");
});
