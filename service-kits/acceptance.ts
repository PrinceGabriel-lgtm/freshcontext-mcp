import { basename, join, resolve } from "node:path";
import { toReadableContextResult } from "../packages/core/src/index.js";
import { evaluateContextInput } from "../src/tools/evaluateContext.js";
import { markdownTable, readJsonFile, usageError, writeJson, writeText } from "./common.js";

interface ExpectedResult {
  decisions?: string[];
  safe_for_agent_handoff?: boolean;
  provenance_states?: string[];
  confidence?: string[];
  min_freshness?: number;
  max_freshness?: number;
}

interface Scenario {
  id: string;
  name?: string;
  /** Free text carried with the fixture for whoever adapts it. Never evaluated. */
  note?: string;
  signal: Record<string, unknown>;
  expected: ExpectedResult;
}

interface AcceptanceInput {
  application_ref?: string;
  service_order_ref?: string;
  workflow_id?: string;
  workflow_name?: string;
  profile: string;
  intent: string;
  now?: string;
  scenarios: Scenario[];
}

interface CheckResult {
  check: string;
  expected: unknown;
  actual: unknown;
  pass: boolean;
}

// The six comparisons evaluateScenario knows how to make, and the type each one
// requires. Anything outside this set in an `expected` block is a mistake, and
// it used to be a silent one: a mistyped `decision:` for `decisions:` survived
// the non-empty check below, matched no comparison, produced zero checks, and
// `checks.every(...)` over an empty array returned true. The scenario reported
// PASS having verified nothing.
//
// That is the contractual mechanism Single-Workflow Integration is sold on, so
// the failure was not cosmetic: a client could accept work against a suite that
// tested none of it. The same every()-over-an-empty-set defect was fixed in
// isHealthyReport([]) elsewhere in this codebase; this is its second home.
const EXPECTED_CHECKS: Record<string, (value: unknown) => boolean> = {
  decisions: (v) => Array.isArray(v) && v.length > 0 && v.every((entry) => typeof entry === "string"),
  provenance_states: (v) => Array.isArray(v) && v.length > 0 && v.every((entry) => typeof entry === "string"),
  confidence: (v) => Array.isArray(v) && v.length > 0 && v.every((entry) => typeof entry === "string"),
  safe_for_agent_handoff: (v) => typeof v === "boolean",
  min_freshness: (v) => typeof v === "number" && Number.isFinite(v),
  max_freshness: (v) => typeof v === "number" && Number.isFinite(v),
};

const EXPECTED_TYPES: Record<string, string> = {
  decisions: "a non-empty array of strings",
  provenance_states: "a non-empty array of strings",
  confidence: "a non-empty array of strings",
  safe_for_agent_handoff: "a boolean",
  min_freshness: "a finite number",
  max_freshness: "a finite number",
};

function assertExpectedShape(scenarioId: string, expected: Record<string, unknown>): void {
  const recognised = Object.keys(EXPECTED_CHECKS);
  for (const [key, value] of Object.entries(expected)) {
    if (!(key in EXPECTED_CHECKS)) {
      throw new Error(
        "scenario " + scenarioId + " has an unrecognised expected check: " + key +
        ". Recognised checks are " + recognised.join(", ") + ".",
      );
    }
    if (!EXPECTED_CHECKS[key](value)) {
      throw new Error(
        "scenario " + scenarioId + " expected." + key + " must be " + EXPECTED_TYPES[key] + ".",
      );
    }
  }
}

function assertScenarioShape(input: AcceptanceInput): void {
  if (!Array.isArray(input.scenarios) || input.scenarios.length === 0) throw new Error("scenarios must contain at least one acceptance case.");
  const ids = new Set<string>();
  for (const scenario of input.scenarios) {
    if (!scenario || typeof scenario !== "object") throw new Error("each scenario must be an object.");
    if (typeof scenario.id !== "string" || !scenario.id.trim()) throw new Error("each scenario must have a non-empty id.");
    if (ids.has(scenario.id)) throw new Error("scenario ids must be unique: " + scenario.id);
    ids.add(scenario.id);
    if (!scenario.signal || typeof scenario.signal !== "object" || Array.isArray(scenario.signal)) throw new Error("scenario " + scenario.id + " must include one signal object.");
    if (!scenario.expected || typeof scenario.expected !== "object" || Array.isArray(scenario.expected)) throw new Error("scenario " + scenario.id + " must include expected checks.");
    if (Object.keys(scenario.expected).length === 0) throw new Error("scenario " + scenario.id + " must define at least one expected check.");
    assertExpectedShape(scenario.id, scenario.expected as Record<string, unknown>);
  }
}

function includesOrSkip(values: string[] | undefined, actual: string, check: string): CheckResult | null {
  if (!values) return null;
  return { check, expected: values, actual, pass: values.includes(actual) };
}

function evaluateScenario(input: AcceptanceInput, scenario: Scenario) {
  const result = evaluateContextInput({ profile: input.profile, intent: input.intent, signals: [scenario.signal], ...(input.now ? { now: input.now } : {}) });
  const item = result.items[0];
  const readable = toReadableContextResult(item.evaluation, item.decision);
  const actual = {
    decision: item.decision.decision,
    label: item.decision.label,
    action: item.decision.action,
    freshness_score: item.evaluation.freshness_score,
    confidence: item.evaluation.ranked.confidence,
    provenance_state: item.evaluation.provenance_readiness.state,
    safe_for_agent_handoff: readable.handoff.safe_for_agent_handoff,
    source: item.evaluation.signal.source,
    why: item.evaluation.explanation,
    warnings: item.decision.warnings,
  };
  const checks: CheckResult[] = [];
  const decision = includesOrSkip(scenario.expected.decisions, actual.decision, "decision"); if (decision) checks.push(decision);
  const provenance = includesOrSkip(scenario.expected.provenance_states, actual.provenance_state, "provenance_state"); if (provenance) checks.push(provenance);
  const confidence = includesOrSkip(scenario.expected.confidence, actual.confidence, "confidence"); if (confidence) checks.push(confidence);
  if (typeof scenario.expected.safe_for_agent_handoff === "boolean") checks.push({ check: "safe_for_agent_handoff", expected: scenario.expected.safe_for_agent_handoff, actual: actual.safe_for_agent_handoff, pass: actual.safe_for_agent_handoff === scenario.expected.safe_for_agent_handoff });
  if (typeof scenario.expected.min_freshness === "number") checks.push({ check: "min_freshness", expected: scenario.expected.min_freshness, actual: actual.freshness_score, pass: typeof actual.freshness_score === "number" && actual.freshness_score >= scenario.expected.min_freshness });
  if (typeof scenario.expected.max_freshness === "number") checks.push({ check: "max_freshness", expected: scenario.expected.max_freshness, actual: actual.freshness_score, pass: typeof actual.freshness_score === "number" && actual.freshness_score <= scenario.expected.max_freshness });
  // Unreachable while assertExpectedShape runs first, and kept anyway: an empty
  // checks array is exactly the shape that used to report PASS. A guarantee this
  // load-bearing should be impossible to reach by two independent routes.
  if (checks.length === 0) throw new Error("scenario " + scenario.id + " produced no checks to evaluate.");
  return { id: scenario.id, name: scenario.name ?? scenario.id, pass: checks.every((check) => check.pass), checks, actual };
}

function toMarkdown(input: AcceptanceInput, results: ReturnType<typeof evaluateScenario>[]): string {
  const passed = results.filter((result) => result.pass).length;
  const rows = [["Scenario", "Result", "Decision", "Freshness", "Confidence", "Provenance", "Handoff"]];
  for (const result of results) rows.push([result.id, result.pass ? "PASS" : "FAIL", result.actual.decision, result.actual.freshness_score === null ? "unknown" : String(Math.round(result.actual.freshness_score)), result.actual.confidence, result.actual.provenance_state, result.actual.safe_for_agent_handoff ? "safe" : "blocked"]);
  const lines = [
    "# FreshContext Workflow Acceptance Evidence", "",
    "**Application reference:** " + (input.application_ref ?? "not supplied"),
    "**Service order:** " + (input.service_order_ref ?? "not supplied"),
    "**Workflow:** " + (input.workflow_name ?? input.workflow_id ?? "unnamed"),
    "**Profile:** " + input.profile,
    "**Intent:** " + input.intent,
    "**Result:** " + passed + "/" + results.length + " scenarios passed",
    "",
    "> This runner proves only the acceptance checks encoded in this file. It does not prove requirements that were not encoded, nor does it certify truth, security, compliance, model safety, or business outcomes.",
    "", "## Scenario summary", "", markdownTable(rows), "", "## Detailed checks", ""
  ];
  for (const result of results) {
    lines.push("### " + result.id + " — " + result.name + " — " + (result.pass ? "PASS" : "FAIL"), "");
    lines.push("- Source: " + result.actual.source);
    lines.push("- Decision: " + result.actual.decision);
    lines.push("- Why: " + result.actual.why);
    for (const check of result.checks) lines.push("- " + (check.pass ? "PASS" : "FAIL") + " `" + check.check + "` — expected " + JSON.stringify(check.expected) + "; actual " + JSON.stringify(check.actual));
    lines.push("");
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  const [inputPath, outputArg] = process.argv.slice(2);
  if (!inputPath) usageError("Usage: npm run service:acceptance -- <acceptance.json> [output-directory]");
  const input = await readJsonFile<AcceptanceInput>(inputPath);
  assertScenarioShape(input);
  const results = input.scenarios.map((scenario) => evaluateScenario(input, scenario));
  const passed = results.filter((result) => result.pass).length;
  const output = resolve(outputArg ?? join("service-output", basename(inputPath, ".json")));
  await writeJson(join(output, "acceptance-evidence.json"), { schema: "freshcontext.service.acceptance.v1", generated_at: new Date().toISOString(), application_ref: input.application_ref ?? null, service_order_ref: input.service_order_ref ?? null, workflow_id: input.workflow_id ?? null, workflow_name: input.workflow_name ?? null, profile: input.profile, intent: input.intent, passed, total: results.length, pass: passed === results.length, scenarios: results });
  await writeText(join(output, "acceptance-evidence.md"), toMarkdown(input, results));
  console.log(JSON.stringify({ ok: passed === results.length, service: "single-workflow-acceptance", output, passed, total: results.length }, null, 2));
  if (passed !== results.length) process.exitCode = 2;
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
