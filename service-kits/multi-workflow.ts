import { basename, join, resolve } from "node:path";
import { evaluateWorkflow, formatDecisionCounts, markdownTable, readJsonFile, usageError, writeJson, writeText, type WorkflowInput } from "./common.js";

interface MultiWorkflowInput {
  application_ref?: string;
  client?: string;
  engagement_name?: string;
  workflows: WorkflowInput[];
}

function validate(input: MultiWorkflowInput): void {
  if (!Array.isArray(input.workflows) || input.workflows.length < 2) throw new Error("multi-workflow input must include at least two workflows.");
  const ids = new Set<string>();
  for (const workflow of input.workflows) {
    const id = workflow.workflow_id ?? workflow.workflow_name;
    if (!id) throw new Error("each workflow must include workflow_id or workflow_name.");
    if (ids.has(id)) throw new Error("workflow identifiers must be unique: " + id);
    ids.add(id);
  }
}

function aggregate(workflows: ReturnType<typeof evaluateWorkflow>[]) {
  const decisions: Record<string, number> = {};
  let total = 0, handoffSafe = 0, handoffBlocked = 0, freshnessUnknown = 0, provenanceIncomplete = 0, lowConfidence = 0;
  for (const workflow of workflows) {
    total += workflow.summary.total;
    handoffSafe += workflow.summary.handoff_safe;
    handoffBlocked += workflow.summary.handoff_blocked;
    freshnessUnknown += workflow.summary.freshness_unknown;
    provenanceIncomplete += workflow.summary.provenance_incomplete;
    lowConfidence += workflow.summary.low_confidence;
    for (const [decision, count] of Object.entries(workflow.summary.decisions)) decisions[decision] = (decisions[decision] ?? 0) + count;
  }
  return { workflows: workflows.length, total, decisions, handoff_safe: handoffSafe, handoff_blocked: handoffBlocked, freshness_unknown: freshnessUnknown, provenance_incomplete: provenanceIncomplete, low_confidence: lowConfidence };
}

function toMarkdown(input: MultiWorkflowInput, workflows: ReturnType<typeof evaluateWorkflow>[], summary: ReturnType<typeof aggregate>): string {
  const rows = [["Workflow", "Profile", "Intent", "Items", "Decisions", "Handoff blocked", "Provenance incomplete"]];
  for (const workflow of workflows) rows.push([workflow.workflow_name ?? workflow.workflow_id ?? "unnamed", workflow.profile, workflow.intent, String(workflow.summary.total), formatDecisionCounts(workflow.summary.decisions), String(workflow.summary.handoff_blocked), String(workflow.summary.provenance_incomplete)]);
  const lines = [
    "# FreshContext Multi-Workflow Evidence", "",
    "**Application reference:** " + (input.application_ref ?? "not supplied"),
    "**Client:** " + (input.client ?? "not supplied"),
    "**Engagement:** " + (input.engagement_name ?? "unnamed"),
    "**Workflows:** " + summary.workflows,
    "**Candidate items:** " + summary.total,
    "",
    "> This report aggregates multiple separately evaluated workflows. It does not turn FreshContext into a multi-tenant control plane, managed SaaS, SLA, or compliance platform.",
    "", "## Portfolio summary", "",
    "- Decisions: " + (formatDecisionCounts(summary.decisions) || "none"),
    "- Handoff-safe: " + summary.handoff_safe,
    "- Handoff-blocked: " + summary.handoff_blocked,
    "- Unknown freshness: " + summary.freshness_unknown,
    "- Incomplete provenance readiness: " + summary.provenance_incomplete,
    "- Low-confidence: " + summary.low_confidence,
    "", "## Workflow matrix", "", markdownTable(rows), ""
  ];
  for (const workflow of workflows) {
    lines.push("## " + (workflow.workflow_name ?? workflow.workflow_id ?? "Workflow"), "");
    lines.push("- Profile: " + workflow.profile);
    lines.push("- Intent: " + workflow.intent);
    lines.push("- Items: " + workflow.summary.total);
    lines.push("- Decisions: " + (formatDecisionCounts(workflow.summary.decisions) || "none"));
    lines.push("- Handoff blocked: " + workflow.summary.handoff_blocked);
    lines.push("- Provenance incomplete: " + workflow.summary.provenance_incomplete, "");
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  const [inputPath, outputArg] = process.argv.slice(2);
  if (!inputPath) usageError("Usage: npm run service:multi -- <multi-workflow.json> [output-directory]");
  const input = await readJsonFile<MultiWorkflowInput>(inputPath);
  validate(input);
  const workflows = input.workflows.map((workflow) => evaluateWorkflow(workflow));
  const summary = aggregate(workflows);
  const output = resolve(outputArg ?? join("service-output", basename(inputPath, ".json")));
  await writeJson(join(output, "multi-workflow-evidence.json"), { schema: "freshcontext.service.multi-workflow.v1", generated_at: new Date().toISOString(), application_ref: input.application_ref ?? null, client: input.client ?? null, engagement_name: input.engagement_name ?? null, summary, workflows, field_meanings: { safe_for_agent_handoff: "The item may be passed to an agent together with the decision recorded beside it. NOT a claim that the content is current, and NOT a claim that it is true. The state this evaluation blocks is unknown, not old." }, limitations: ["This evidence does not itself provide tenancy, SSO, compliance certification, continuous managed operations, or an SLA.", "Each workflow remains an explicitly configured evaluation path."] });
  await writeText(join(output, "multi-workflow-evidence.md"), toMarkdown(input, workflows, summary));
  console.log(JSON.stringify({ ok: true, service: "private-multi-workflow-evidence", output, workflows: summary.workflows, total: summary.total, handoff_blocked: summary.handoff_blocked }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exit(1); });
