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

// Regression guard for F-7 (2026-07-18 tool-mix audit): several tools stamped their
// freshness envelope from `new Date()` unconditionally instead of the real source date,
// even when that date was already computed in scope. `package_trends` was the sharpest
// case, fixed first (mechanical, zero design ambiguity). The 5 landscape composites +
// search_jobs's fallback were the same bug class but needed a design decision first —
// resolved 2026-07-18 (weakest-link policy: compositeEnvelope() takes the OLDEST
// contributing date and the LOWEST confidence among fulfilled sources). This guard now
// covers all of it.
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

describe("composite freshness-envelope regression guard (F-7, landscape tools)", () => {
  const worker = readFileSync("worker/src/worker.ts", "utf8");

  test("compositeEnvelope() helper exists with weakest-link semantics", () => {
    assert.match(
      worker,
      /const compositeEnvelope = \(/,
      "compositeEnvelope() must exist — the shared weakest-link envelope helper for composite tools"
    );
  });

  for (const tool of [
    "extract_gov_landscape",
    "extract_finance_landscape",
    "extract_company_landscape",
    "extract_idea_landscape",
  ] as const) {
    test(`${tool} must not stamp its envelope date as 'today' unconditionally`, () => {
      const toolBody = worker.match(new RegExp(`server\\.registerTool\\("${tool}",[\\s\\S]*?\\n  \\}\\);`))?.[0];
      assert.ok(toolBody, `${tool} tool registration not found in worker/src/worker.ts`);
      // Only the final return-stamp statement matters here — the body still legitimately
      // contains `new Date()` for its own "Generated: <timestamp>" display line, which is
      // an assembly timestamp, not a freshness claim, and is out of scope for this guard.
      const returnStamp = toolBody.match(/return ok\(stamp\(body,[\s\S]*?\)\);/)?.[0];
      assert.ok(returnStamp, `${tool}'s final stamp() return not found`);
      assert.doesNotMatch(
        returnStamp,
        /new Date\(\)/,
        `${tool} must use compositeEnvelope(), not new Date(), for its envelope date/confidence`
      );
      assert.match(
        toolBody,
        /const envelope = compositeEnvelope\(/,
        `${tool} must compute its envelope via compositeEnvelope()`
      );
    });
  }

  test("extract_landscape must not stamp its envelope date as 'today' unconditionally", () => {
    const toolBody = worker.match(/server\.registerTool\("extract_landscape",[\s\S]*?\n  \}\);/)?.[0];
    assert.ok(toolBody, "extract_landscape tool registration not found in worker/src/worker.ts");
    const returnStamp = toolBody.match(/return ok\(stamp\(sections,[\s\S]*?\)\);/)?.[0];
    assert.ok(returnStamp, "extract_landscape's final stamp() return not found");
    assert.doesNotMatch(
      returnStamp,
      /new Date\(\)/,
      "extract_landscape must use compositeEnvelope(), not new Date(), for its envelope date/confidence"
    );
    assert.match(
      toolBody,
      /const envelope = compositeEnvelope\(\[hn, repos, pkg\]\)/,
      "extract_landscape must compute its envelope via compositeEnvelope()"
    );
  });

  test("extract_landscape's description must not claim a YC source it does not call", () => {
    const toolBody = worker.match(/server\.registerTool\("extract_landscape",[\s\S]*?\n  \}\);/)?.[0];
    assert.ok(toolBody, "extract_landscape tool registration not found in worker/src/worker.ts");
    const description = toolBody.match(/description:\s*"([^"]*)"/)?.[1];
    assert.ok(description, "extract_landscape's description string not found");
    assert.doesNotMatch(
      description,
      /YC/i,
      "extract_landscape's description must not mention YC — the implementation never calls fetchYC (use extract_idea_landscape for YC funding signal)"
    );
  });

  test("search_jobs must not stamp its envelope date as 'today' on the no-date fallback", () => {
    const toolBody = worker.match(/server\.registerTool\("search_jobs",[\s\S]*?\n  \}\);/)?.[0];
    assert.ok(toolBody, "search_jobs tool registration not found in worker/src/worker.ts");
    assert.doesNotMatch(
      toolBody,
      /newestDate \?\? new Date\(\)/,
      "search_jobs must stamp `newestDate` (null when no listing had a usable date), not fall back to today"
    );
  });
});
