import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
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
