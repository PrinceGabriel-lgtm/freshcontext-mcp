import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { evaluateWorkflow } from "../service-kits/common.ts";

const tsxCli = path.resolve("node_modules/tsx/dist/cli.mjs");

function runScript(script: string, fixture: string) {
  const output = mkdtempSync(path.join(tmpdir(), "freshcontext-service-kit-"));
  const result = spawnSync(process.execPath, [tsxCli, path.resolve(script), path.resolve(fixture), output], { encoding: "utf8" });
  return { output, result };
}

test("service kit evaluates real Core output and preserves handoff honesty", () => {
  const report = evaluateWorkflow({
    workflow_id: "test-workflow",
    profile: "academic_research",
    intent: "citation_check",
    now: "2026-09-21T10:00:00.000Z",
    signals: [
      { id: "good", source: "https://arxiv.org/abs/2609.00001", source_type: "arxiv", title: "Recent paper", content: "Recent relevant research.", published_at: "2026-09-18T00:00:00.000Z", retrieved_at: "2026-09-21T09:50:00.000Z", semantic_score: 0.96, date_confidence: "high", status: "success" },
      { id: "failed", source: "https://arxiv.org/abs/2609.99999", source_type: "arxiv", title: "Unavailable", content: "[ERROR] upstream fetch failed", published_at: null, retrieved_at: "2026-09-21T09:50:00.000Z", semantic_score: 0.1, date_confidence: "unknown", status: "failed" },
    ],
  });
  assert.equal(report.summary.total, 2);
  assert.ok(report.summary.handoff_safe >= 1);
  assert.ok(report.summary.handoff_blocked >= 1);
  assert.ok(report.items.some((item) => item.decision === "exclude" && item.safe_for_agent_handoff === false));
});

test("assessment runner emits machine-readable and human evidence", () => {
  const { output, result } = runScript("service-kits/assessment.ts", "service-kits/examples/assessment.example.json");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(path.join(output, "assessment-evidence.json")), true);
  assert.equal(existsSync(path.join(output, "assessment-evidence.md")), true);
  const body = JSON.parse(readFileSync(path.join(output, "assessment-evidence.json"), "utf8"));
  assert.equal(body.schema, "freshcontext.service.assessment.v1");
  assert.equal(body.workflow.summary.total, 3);
  assert.match(readFileSync(path.join(output, "assessment-evidence.md"), "utf8"), /Human assessment required/);
});

test("acceptance runner passes the deterministic example suite", () => {
  const { output, result } = runScript("service-kits/acceptance.ts", "service-kits/examples/acceptance.example.json");
  assert.equal(result.status, 0, result.stderr + "\n" + result.stdout);
  const body = JSON.parse(readFileSync(path.join(output, "acceptance-evidence.json"), "utf8"));
  assert.equal(body.schema, "freshcontext.service.acceptance.v1");
  assert.equal(body.pass, true);
  assert.equal(body.total, 2);
});

test("multi-workflow runner aggregates separately evaluated workflows", () => {
  const { output, result } = runScript("service-kits/multi-workflow.ts", "service-kits/examples/multi-workflow.example.json");
  assert.equal(result.status, 0, result.stderr);
  const body = JSON.parse(readFileSync(path.join(output, "multi-workflow-evidence.json"), "utf8"));
  assert.equal(body.schema, "freshcontext.service.multi-workflow.v1");
  assert.equal(body.summary.workflows, 2);
  assert.equal(body.summary.total, 4);
});

test("build-to-spec validator emits milestone acceptance evidence", () => {
  const { output, result } = runScript("service-kits/build-spec.ts", "service-kits/examples/build-spec.example.json");
  assert.equal(result.status, 0, result.stderr);
  const body = JSON.parse(readFileSync(path.join(output, "build-spec.json"), "utf8"));
  assert.equal(body.schema, "freshcontext.service.build-spec.v1");
  assert.equal(body.milestones.length, 2);
  assert.deepEqual(body.validation_warnings, []);
});

// ---------------------------------------------------------------------------
// The commercial guarantees. Every test above asserts status === 0, so nothing
// pinned the behaviour a Service Order actually sells: that a failed acceptance
// scenario is loud. These do.
// ---------------------------------------------------------------------------

function runWithFixture(script: string, fixture: unknown) {
  const dir = mkdtempSync(path.join(tmpdir(), "freshcontext-service-kit-fixture-"));
  const file = path.join(dir, "fixture.json");
  writeFileSync(file, JSON.stringify(fixture, null, 2));
  return runScript(script, file);
}

test("acceptance runner exits non-zero when a contracted scenario fails", () => {
  // Same suite the passing test uses, with one expectation inverted: assert that
  // recent, well-provenanced context is NOT handoff-safe. The engine disagrees,
  // so the scenario must fail and the runner must say so in its exit code —
  // that is what makes an acceptance schedule enforceable rather than a demo.
  const suite = JSON.parse(readFileSync("service-kits/examples/acceptance.example.json", "utf8"));
  const inverted = suite.scenarios.find((s: { id: string }) => s.id === "A-01");
  assert.ok(inverted, "example suite must still contain scenario A-01");
  inverted.expected.safe_for_agent_handoff = false;

  const { output, result } = runWithFixture("service-kits/acceptance.ts", suite);
  assert.notEqual(result.status, 0, "a failed acceptance scenario must not exit 0");

  const body = JSON.parse(readFileSync(path.join(output, "acceptance-evidence.json"), "utf8"));
  assert.equal(body.pass, false);
  assert.ok(body.passed < body.total, "the failing scenario must be counted as failed");
  const failed = body.scenarios.find((s: { id: string }) => s.id === "A-01");
  assert.equal(failed.pass, false);
});

test("degraded context is never promoted to a primary citation", () => {
  // The invariant the product actually rests on, over the three degraded shapes
  // a client fixture arrives in.
  //
  // Note what is NOT asserted: that stale content is handoff-unsafe. A 2019
  // document with high date confidence comes back use_as_background and
  // safe_for_agent_handoff = true, and that is correct. Its age is known and
  // labelled, so an agent receiving it WITH that decision has been told what it
  // is. The failure this engine exists to prevent is staleness that is
  // invisible, not staleness that is disclosed. Unknown, not old, is the
  // dangerous state — which is why the undated signal IS blocked while the
  // older one is not.
  const report = evaluateWorkflow({
    workflow_id: "degraded-inputs",
    profile: "official_docs",
    intent: "developer_adoption",
    now: "2026-09-21T10:00:00.000Z",
    signals: [
      { id: "failed", source: "https://docs.example.com/gone", source_type: "official_docs", title: "Unavailable", content: "[ERROR] upstream fetch failed", published_at: null, retrieved_at: "2026-09-21T09:50:00.000Z", semantic_score: 0.2, date_confidence: "unknown", status: "failed" },
      { id: "undated", source: "https://docs.example.com/undated", source_type: "official_docs", title: "No publication date", content: "Documentation with no discoverable date.", published_at: null, retrieved_at: "2026-09-21T09:50:00.000Z", semantic_score: 0.9, date_confidence: "unknown", status: "success" },
      { id: "stale", source: "https://docs.example.com/2019", source_type: "official_docs", title: "Superseded release notes", content: "Release notes for a long-superseded version.", published_at: "2019-01-01T00:00:00.000Z", retrieved_at: "2026-09-21T09:50:00.000Z", semantic_score: 0.9, date_confidence: "high", status: "success" },
    ],
  });

  const byId = (id: string) => {
    const item = report.items.find((i) => i.id === id);
    assert.ok(item, `${id} must appear in the report`);
    return item;
  };

  // 1. Nothing degraded is ever offered as a primary citation.
  for (const id of ["failed", "undated", "stale"]) {
    assert.notEqual(byId(id).decision, "cite_as_primary", `${id} must never be cite_as_primary`);
  }

  // 2. Unknown state is blocked from handoff. This is the load-bearing one.
  assert.equal(byId("failed").decision, "exclude");
  assert.equal(byId("failed").safe_for_agent_handoff, false);
  assert.equal(byId("undated").safe_for_agent_handoff, false, "an undateable source must not be handoff-safe");

  // 3. Known-old content is demoted and disclosed rather than blocked.
  assert.equal(byId("stale").decision, "use_as_background");

  // 4. The weaknesses stay visible in the summary rather than being averaged away.
  assert.equal(report.summary.freshness_unknown, 2);
  assert.equal(report.summary.provenance_incomplete, 2);
  assert.equal(report.summary.handoff_blocked, 2);
});

test("build-to-spec warns on unfalsifiable wording but not on FreshContext's own verdicts", () => {
  const base = JSON.parse(readFileSync("service-kits/examples/build-spec.example.json", "utf8"));

  const vague = JSON.parse(JSON.stringify(base));
  vague.milestones[0].acceptance_tests[0].expected_observable_result = "It works well and is enterprise ready.";
  const flagged = runWithFixture("service-kits/build-spec.ts", vague);
  assert.equal(flagged.result.status, 0, flagged.result.stderr);
  const flaggedBody = JSON.parse(readFileSync(path.join(flagged.output, "build-spec.json"), "utf8"));
  assert.equal(flaggedBody.validation_warnings.length, 1, "unfalsifiable wording must warn");
  assert.match(flaggedBody.validation_warnings[0], /subjective acceptance wording/);

  // A binary criterion phrased in the product's own vocabulary. The previous
  // pattern flagged this, which told a buyer their correct acceptance test was
  // subjective.
  const sound = JSON.parse(JSON.stringify(base));
  sound.milestones[0].acceptance_tests[0].expected_observable_result =
    "The stale fixture is reported as not safe for agent handoff.";
  const clean = runWithFixture("service-kits/build-spec.ts", sound);
  assert.equal(clean.result.status, 0, clean.result.stderr);
  const cleanBody = JSON.parse(readFileSync(path.join(clean.output, "build-spec.json"), "utf8"));
  assert.deepEqual(cleanBody.validation_warnings, [], "product vocabulary must not be called subjective");
});

test("service-kit evidence output cannot be committed to this repository", () => {
  // The runners write client fixtures, source URLs and document content into
  // service-output/. One `git add -A` mid-engagement would put a client's
  // material into git history permanently. SOP-009 forbids it; this asserts the
  // repository mechanically enforces it.
  const probe = "service-output/__gitignore_probe__/client-evidence.json";
  const checked = spawnSync("git", ["check-ignore", "-q", probe], { encoding: "utf8" });
  assert.equal(checked.status, 0, "service-output/ must be gitignored");
});
