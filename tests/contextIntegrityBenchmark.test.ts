// Tests for the Context Integrity Benchmark harness itself.
//
// A benchmark that is never tested is a benchmark nobody should trust: if the harness
// silently stops checking, every metric goes to 1.0 and looks better than before. These
// tests cover the harness, not the engine — the engine's behaviour is what the fixtures
// assert when the benchmark runs.

import test, { describe } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = join(import.meta.dirname, "..");
const RUNNER = join(REPO, "benchmarks", "context-integrity-v1", "run.ts");
const FIXTURES = join(REPO, "benchmarks", "context-integrity-v1", "fixtures.json");
const TSX = join(REPO, "node_modules", "tsx", "dist", "cli.mjs");

function runBenchmark(args: string[] = []): { stdout: string; status: number } {
  try {
    const stdout = execFileSync(process.execPath, [TSX, RUNNER, ...args], {
      cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
    return { stdout, status: 0 };
  } catch (error) {
    const e = error as { stdout?: string; status?: number };
    return { stdout: e.stdout ?? "", status: e.status ?? 1 };
  }
}

describe("context integrity benchmark harness", () => {
  test("fixtures parse and declare the expected families", () => {
    const fixtures = JSON.parse(readFileSync(FIXTURES, "utf8"));
    assert.equal(fixtures.benchmark, "context-integrity-v1");
    assert.ok(Array.isArray(fixtures.families) && fixtures.families.length > 0);
    assert.deepEqual(fixtures.families.map((f: { id: string }) => f.id), ["A", "B", "C", "D"]);
    // A fixed benchmark clock is what makes the run reproducible at all.
    assert.match(fixtures.now, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  test("every case carries an id, a description and at least one assertion", () => {
    const fixtures = JSON.parse(readFileSync(FIXTURES, "utf8"));
    for (const family of fixtures.families) {
      for (const kase of family.cases) {
        assert.ok(kase.id, "case must have an id");
        assert.ok(kase.description, `${kase.id} must describe what it is for`);
        assert.ok(kase.signals?.length > 0, `${kase.id} must carry signals`);
        assert.ok(Object.keys(kase.assert ?? {}).length > 0, `${kase.id} must assert something`);
        assert.ok(kase.profile || kase.profiles, `${kase.id} must name a profile`);
      }
    }
  });

  test("the benchmark runs green and emits a manifest with reproducibility fields", () => {
    const dir = mkdtempSync(join(tmpdir(), "cib1-"));
    try {
      const out = join(dir, "results.json");
      const { status } = runBenchmark(["--json", out]);
      assert.equal(status, 0, "benchmark must exit 0 when every check passes");

      const r = JSON.parse(readFileSync(out, "utf8"));
      for (const field of [
        "benchmark_name", "benchmark_version", "fixture_version", "freshcontext_version",
        "node_version", "benchmark_clock", "fixture_sha256", "case_count", "check_count",
        "per_family", "metrics", "result_sha256", "limitations",
      ]) {
        assert.ok(field in r, `manifest must carry ${field}`);
      }
      assert.equal(r.failures.length, 0);
      assert.equal(r.metrics.determinism_rate, 1);
      assert.equal(r.metrics.total_contract_pass_rate, 1);
      assert.ok(r.limitations.length >= 4, "the manifest must state what it does not prove");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("two runs over unchanged fixtures produce an identical result digest", () => {
    const dir = mkdtempSync(join(tmpdir(), "cib1-"));
    try {
      const a = join(dir, "a.json");
      const b = join(dir, "b.json");
      runBenchmark(["--json", a]);
      runBenchmark(["--json", b]);
      const ra = JSON.parse(readFileSync(a, "utf8"));
      const rb = JSON.parse(readFileSync(b, "utf8"));
      // result_sha256 excludes git_sha and node_version so it digests the measurement,
      // not the machine it ran on.
      assert.equal(ra.result_sha256, rb.result_sha256, "the benchmark must be reproducible");
      assert.equal(ra.fixture_sha256, rb.fixture_sha256);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the harness actually fails when an expectation is not met", () => {
    // Without this, a harness that had stopped checking would report a perfect score and
    // no test would notice. Corrupt one expectation and require a non-zero exit.
    const dir = mkdtempSync(join(tmpdir(), "cib1-"));
    const backup = readFileSync(FIXTURES, "utf8");
    try {
      const fixtures = JSON.parse(backup);
      const familyC = fixtures.families.find((f: { id: string }) => f.id === "C");
      familyC.cases[0].assert.decisions.healthy = "exclude"; // healthy is use_first
      writeFileSync(FIXTURES, JSON.stringify(fixtures, null, 2));

      const { status, stdout } = runBenchmark(["--json", join(dir, "bad.json")]);
      assert.notEqual(status, 0, "a violated expectation must fail the run");
      assert.match(stdout, /Total contract pass rate \| (?!1\b)/, "the pass rate must drop below 1");
    } finally {
      writeFileSync(FIXTURES, backup);
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the benchmark is source-checkout only and never enters the npm tarball", () => {
    const pkg = JSON.parse(readFileSync(join(REPO, "package.json"), "utf8"));
    assert.ok(
      !pkg.files.some((f: string) => f.includes("benchmark")),
      "benchmarks must not be listed in package.json files[]",
    );
    assert.ok(
      pkg.scripts["benchmark:context-integrity"].startsWith("node package-script-guard.mjs"),
      "the benchmark script must go through the source-checkout guard",
    );
  });
});
