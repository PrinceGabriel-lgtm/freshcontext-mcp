import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Narrow regression guard for the 2026-07-08 freshness-anchor fixes (review Findings F-1/F-2).
//
// The adapters exist in TWO implementations that drift (F-1): the npm copies in
// src/adapters/* and the deployed inline fetch*/stamp calls in worker/src/worker.ts. The
// arc's anchor fixes had to be applied to BOTH. Two specific bugs were fixed: YC stamping
// every listing as "today" (perpetual false freshness) and Scholar anchoring at ${year}-01-01
// (systematic ~6-month over-aging).
//
// This is NOT a behavioral parity test — the adapters are browser-bound (playwright /
// @cloudflare/puppeteer) and cannot be run headless here. It is a source-level guard that
// fails if either known-bad anchor pattern reappears in either implementation. The real fix
// for the duplication is consolidation (one adapter layer); that is a tracked architecture
// decision. Until then, this pins the two bugs so they cannot silently come back.

describe("adapter freshness-anchor regression guard (F-1/F-2)", () => {
  const ycNpm = readFileSync("src/adapters/yc.ts", "utf8");
  const scholarNpm = readFileSync("src/adapters/scholar.ts", "utf8");
  const worker = readFileSync("worker/src/worker.ts", "utf8");

  test("YC must not stamp content_date as 'today' — npm copy", () => {
    assert.doesNotMatch(
      ycNpm,
      /content_date:\s*new Date\(\)/,
      "src/adapters/yc.ts must not date YC listings as today (use null — freshness unknown)"
    );
  });

  test("YC must not stamp the deployed tool's date as 'today' — worker copy", () => {
    // The fixed deployed call is `stamp(raw, safeUrl, null, "low", "yc")`. A regression would
    // pass `new Date()...` as the date argument again. Pin the fixed null-date shape.
    assert.match(
      worker,
      /null,\s*"low",\s*"yc"/,
      "worker extract_yc must stamp a null date (freshness unknown), not today"
    );
  });

  test("Scholar must not anchor at Jan 1 (${year}-01-01) — npm + deployed", () => {
    assert.doesNotMatch(
      scholarNpm,
      /\{\s*newestYear\s*\}-01-01/,
      "src/adapters/scholar.ts must not anchor Scholar dates at Jan 1 (use mid-year)"
    );
    assert.doesNotMatch(
      worker,
      /\{\s*newest\s*\}-01-01/,
      "worker extract_scholar must not anchor Scholar dates at Jan 1 (use mid-year)"
    );
  });

  // 2026-07-18 extensions: the original guard covered extract_yc (browser path) but not
  // fetchYC (yc-oss JSON helper feeding extract_idea_landscape) — which is exactly where
  // the today-stamp bug survived the 2026-07-08 fix. And Scholar's year-only anchor was
  // still claiming "high" confidence; ±6 months of real uncertainty is "medium".

  test("fetchYC (yc-oss helper) must not stamp its date as 'today' — worker", () => {
    const fetchYcBody = worker.match(/async function fetchYC\([\s\S]*?\n\}/)?.[0];
    assert.ok(fetchYcBody, "fetchYC function not found in worker/src/worker.ts");
    assert.doesNotMatch(
      fetchYcBody,
      /new Date\(\)/,
      "worker fetchYC must stamp a null date (freshness unknown), not today"
    );
    assert.match(
      fetchYcBody,
      /date:\s*null,\s*conf:\s*"low"/,
      "worker fetchYC must return { date: null, conf: \"low\" } like extract_yc and src/adapters/yc.ts"
    );
  });

  test("Scholar year-only anchor must claim at most 'medium' confidence — npm + deployed", () => {
    assert.match(
      scholarNpm,
      /newestYear\s*\?\s*"medium"\s*:\s*"low"/,
      "src/adapters/scholar.ts must not claim high confidence for a year-only date anchor"
    );
    assert.match(
      worker,
      /newest\s*\?\s*"medium"\s*:\s*"low"/,
      "worker extract_scholar must not claim high confidence for a year-only date anchor"
    );
  });
});

// Narrow regression guard for F-7 (2026-07-18 tool-mix audit): several tools stamp their
// freshness envelope from `new Date()` unconditionally instead of the real source date,
// even when that date was already computed in scope. `package_trends` was the sharpest
// case — it computes npm's `time.modified` / PyPI's `upload_time` and prints it in the
// visible text, then discarded that same value for the envelope. This is the one F-7
// instance fixed so far (a mechanical, zero-design-ambiguity fix); the 5 landscape
// composites + search_jobs's fallback are the same bug class but need a design decision
// (oldest vs newest vs null+per-section) before they can be fixed — see the state skill's
// F-7 entry. Do not extend this guard to the composites until that decision is made.
describe("tool freshness-envelope regression guard (F-7, package_trends)", () => {
  const worker = readFileSync("worker/src/worker.ts", "utf8");

  test("package_trends must not stamp its envelope date as 'today' unconditionally", () => {
    const toolBody = worker.match(/server\.registerTool\("package_trends",[\s\S]*?\n  \}\);/)?.[0];
    assert.ok(toolBody, "package_trends tool registration not found in worker/src/worker.ts");
    assert.doesNotMatch(
      toolBody,
      /stamp\(raw,\s*"package-registries",\s*new Date\(\)/,
      "package_trends must not stamp today unconditionally — it must use the real computed `latest` date, like fetchPackageTrends"
    );
    assert.match(
      toolBody,
      /stamp\(raw,\s*"package-registries",\s*latest,\s*latest\s*\?\s*"high"\s*:\s*"low"/,
      "package_trends must stamp { latest, latest ? \"high\" : \"low\" } — the real newest release date it already computes"
    );
  });
});
