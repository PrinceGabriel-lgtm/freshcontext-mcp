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
});
