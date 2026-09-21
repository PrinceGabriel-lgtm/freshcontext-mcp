import { basename, join, resolve } from "node:path";
import { markdownTable, readJsonFile, usageError, writeJson, writeText } from "./common.js";

interface AcceptanceTest {
  id: string;
  description: string;
  input_or_fixture: string;
  expected_observable_result: string;
}

interface Milestone {
  id: string;
  name: string;
  deliverables: string[];
  acceptance_tests: AcceptanceTest[];
}

interface BuildSpecInput {
  application_ref?: string;
  client?: string;
  capability: string;
  problem_statement: string;
  environment: string;
  dependencies?: string[];
  background_ip_notes?: string[];
  client_deliverables?: string[];
  milestones: Milestone[];
}

const SUBJECTIVE = /\b(better|robust|enterprise[- ]ready|safe|accurate|high quality|works well|seamless|trusted)\b/i;

function nonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(field + " must be a non-empty string.");
  return value.trim();
}

function validate(input: BuildSpecInput): string[] {
  nonEmpty(input.capability, "capability");
  nonEmpty(input.problem_statement, "problem_statement");
  nonEmpty(input.environment, "environment");
  if (!Array.isArray(input.milestones) || input.milestones.length === 0) throw new Error("milestones must contain at least one milestone.");
  const warnings: string[] = [];
  const milestoneIds = new Set<string>();
  const testIds = new Set<string>();
  for (const milestone of input.milestones) {
    nonEmpty(milestone.id, "milestone.id");
    nonEmpty(milestone.name, "milestone.name");
    if (milestoneIds.has(milestone.id)) throw new Error("duplicate milestone id: " + milestone.id);
    milestoneIds.add(milestone.id);
    if (!Array.isArray(milestone.deliverables) || milestone.deliverables.length === 0) throw new Error("milestone " + milestone.id + " must include deliverables.");
    if (!Array.isArray(milestone.acceptance_tests) || milestone.acceptance_tests.length === 0) throw new Error("milestone " + milestone.id + " must include acceptance_tests.");
    for (const test of milestone.acceptance_tests) {
      nonEmpty(test.id, "acceptance_test.id");
      nonEmpty(test.description, "acceptance_test.description");
      nonEmpty(test.input_or_fixture, "acceptance_test.input_or_fixture");
      nonEmpty(test.expected_observable_result, "acceptance_test.expected_observable_result");
      if (testIds.has(test.id)) throw new Error("duplicate acceptance test id: " + test.id);
      testIds.add(test.id);
      if (SUBJECTIVE.test(test.expected_observable_result)) warnings.push(test.id + " contains subjective acceptance wording; replace it with a binary or measurable result.");
    }
  }
  if (!input.background_ip_notes || input.background_ip_notes.length === 0) warnings.push("No background_ip_notes supplied; explicitly identify pre-existing FreshContext technology before issue.");
  if (!input.client_deliverables || input.client_deliverables.length === 0) warnings.push("No client_deliverables supplied; explicitly identify buyer-specific deliverables before issue.");
  return warnings;
}

function toMarkdown(input: BuildSpecInput, warnings: string[]): string {
  const milestoneRows = [["Milestone", "Name", "Deliverables", "Acceptance tests"]];
  for (const m of input.milestones) milestoneRows.push([m.id, m.name, m.deliverables.join("; "), m.acceptance_tests.map((t) => t.id).join(", ")]);
  const testRows = [["ID", "Milestone", "Description", "Input / fixture", "Expected observable result"]];
  for (const m of input.milestones) for (const t of m.acceptance_tests) testRows.push([t.id, m.id, t.description, t.input_or_fixture, t.expected_observable_result]);
  return [
    "# FreshContext Build-to-Spec Technical Specification", "",
    "**Application reference:** " + (input.application_ref ?? "not supplied"),
    "**Client:** " + (input.client ?? "not supplied"),
    "**Capability:** " + input.capability,
    "**Environment:** " + input.environment,
    "",
    "## Problem statement", "", input.problem_statement, "",
    "## Milestones", "", markdownTable(milestoneRows), "",
    "## Acceptance tests", "", markdownTable(testRows), "",
    "## Dependencies", "", ...(input.dependencies?.length ? input.dependencies.map((d) => "- " + d) : ["- None supplied"]), "",
    "## Background IP notes", "", ...(input.background_ip_notes?.length ? input.background_ip_notes.map((d) => "- " + d) : ["- TO BE COMPLETED BEFORE ISSUE"]), "",
    "## Client-specific deliverables", "", ...(input.client_deliverables?.length ? input.client_deliverables.map((d) => "- " + d) : ["- TO BE COMPLETED BEFORE ISSUE"]), "",
    "## Validation warnings", "", ...(warnings.length ? warnings.map((w) => "- " + w) : ["- None"]), "",
    "> Historical MIT rights are not withdrawn by this specification. Exclusivity, assignment, source ownership, or broad future rights require an explicit executed agreement.",
  ].join("\n");
}

async function main(): Promise<void> {
  const [inputPath, outputArg] = process.argv.slice(2);
  if (!inputPath) usageError("Usage: npm run service:spec -- <build-spec.json> [output-directory]");
  const input = await readJsonFile<BuildSpecInput>(inputPath);
  const warnings = validate(input);
  const output = resolve(outputArg ?? join("service-output", basename(inputPath, ".json")));
  await writeJson(join(output, "build-spec.json"), { schema: "freshcontext.service.build-spec.v1", generated_at: new Date().toISOString(), ...input, validation_warnings: warnings });
  await writeText(join(output, "build-spec.md"), toMarkdown(input, warnings));
  console.log(JSON.stringify({ ok: true, service: "build-to-spec", output, milestones: input.milestones.length, warnings }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
