import { basename, join, resolve } from "node:path";
import { evaluateWorkflow, formatDecisionCounts, markdownTable, readJsonFile, usageError, writeJson, writeText, type WorkflowInput } from "./common.js";

interface AssessmentInput extends WorkflowInput {
  application_ref?: string;
  client?: string;
  notes?: string;
}

interface AssessmentFinding {
  severity: "info" | "attention";
  category: "freshness" | "provenance" | "confidence" | "decision";
  message: string;
}

function findings(report: ReturnType<typeof evaluateWorkflow>): AssessmentFinding[] {
  const out: AssessmentFinding[] = [];
  if (report.summary.freshness_unknown > 0) out.push({ severity: "attention", category: "freshness", message: report.summary.freshness_unknown + " candidate item(s) have unknown freshness and should not be presented as current without additional dating evidence." });
  if (report.summary.provenance_incomplete > 0) out.push({ severity: "attention", category: "provenance", message: report.summary.provenance_incomplete + " item(s) have incomplete provenance readiness." });
  if (report.summary.low_confidence > 0) out.push({ severity: "attention", category: "confidence", message: report.summary.low_confidence + " item(s) are low-confidence." });
  if (report.summary.handoff_blocked > 0) out.push({ severity: "attention", category: "decision", message: report.summary.handoff_blocked + " item(s) are not safe for agent handoff under the current decision/provenance policy." });
  if (out.length === 0) out.push({ severity: "info", category: "decision", message: "No evidence-level attention flags were produced for this supplied sample set. This is not a truth, security, compliance, or production-readiness certification." });
  return out;
}

function toMarkdown(input: AssessmentInput, report: ReturnType<typeof evaluateWorkflow>, assessmentFindings: AssessmentFinding[]): string {
  const itemRows = [
    ["#", "Source", "Decision", "Freshness", "Confidence", "Provenance", "Handoff"],
    ...report.items.map((item) => [
      String(item.index),
      item.title ?? item.source,
      item.decision,
      item.freshness_score === null ? "unknown" : String(Math.round(item.freshness_score)),
      item.confidence,
      item.provenance_state,
      item.safe_for_agent_handoff ? "safe" : "blocked",
    ]),
  ];
  const lines: string[] = [
    "# FreshContext Context Integrity Assessment Evidence",
    "",
    "**Application reference:** " + (input.application_ref ?? "not supplied"),
    "**Client:** " + (input.client ?? "not supplied"),
    "**Workflow:** " + (report.workflow_name ?? report.workflow_id ?? "unnamed"),
    "**Profile:** " + report.profile,
    "**Intent:** " + report.intent,
    "",
    "> This report is generated from the candidate context supplied for the assessment. FreshContext evaluates context integrity and decision readiness; it does not certify truth, legal compliance, model safety, or business outcomes.",
    "",
    "## Evidence summary",
    "",
    "- Candidate items: " + report.summary.total,
    "- Decision counts: " + (formatDecisionCounts(report.summary.decisions) || "none"),
    "- Handoff-safe: " + report.summary.handoff_safe,
    "- Handoff-blocked: " + report.summary.handoff_blocked,
    "- Unknown freshness: " + report.summary.freshness_unknown,
    "- Incomplete provenance readiness: " + report.summary.provenance_incomplete,
    "- Low-confidence items: " + report.summary.low_confidence,
    "",
    "## How to read these fields",
    "",
    "`safe_for_agent_handoff` means the item can be passed to an agent **together with the decision recorded beside it**. It does not mean the content is current, and it does not mean the content is true.",
    "",
    "A document published years ago can be handoff-safe. If its age is known and it is labelled `use_as_background`, an agent receiving it has been told what it is, which is the condition that makes it safe to pass on. The state this evaluation blocks is *unknown*, not *old*: an item whose publication date could not be established is reported handoff-blocked even when its content looks strong, while an openly dated older item may not be.",
    "",
    "So read the two counts above as: how many items carry a decision an agent can act on, and how many are withheld because something about them could not be established.",
    "",
    "## Findings",
    "",
    ...assessmentFindings.map((finding) => "- **" + finding.severity.toUpperCase() + " / " + finding.category + ":** " + finding.message),
    "",
    "## Candidate evidence",
    "",
    markdownTable(itemRows),
    "",
    "## Item reasons",
    "",
  ];
  for (const item of report.items) {
    lines.push("### " + item.index + ". " + (item.title ?? item.source), "");
    lines.push("- Source: " + item.source);
    lines.push("- Decision: " + item.label + " (`" + item.decision + "`)");
    lines.push("- Action: " + item.action);
    lines.push("- Why: " + item.why);
    lines.push("- Warnings: " + (item.warnings.length ? item.warnings.join("; ") : "None"), "");
  }
  lines.push("## Human assessment required", "");
  lines.push("The generated evidence should be interpreted by the engagement owner before a client-facing Fit Map, failure-mode register, implementation estimate, or recommendation is issued. The generator intentionally does not convert evidence into a legal, security, compliance, or truth conclusion.", "");
  if (input.notes) lines.push("## Engagement notes", "", input.notes, "");
  return lines.join("\n");
}

async function main(): Promise<void> {
  const [inputPath, outputArg] = process.argv.slice(2);
  if (!inputPath) usageError("Usage: npm run service:assessment -- <input.json> [output-directory]");
  const input = await readJsonFile<AssessmentInput>(inputPath);
  const report = evaluateWorkflow(input);
  const assessmentFindings = findings(report);
  const output = resolve(outputArg ?? join("service-output", basename(inputPath, ".json")));
  await writeJson(join(output, "assessment-evidence.json"), {
    schema: "freshcontext.service.assessment.v1",
    generated_at: new Date().toISOString(),
    application_ref: input.application_ref ?? null,
    client: input.client ?? null,
    workflow: report,
    findings: assessmentFindings,
    field_meanings: {
      safe_for_agent_handoff:
        "The item may be passed to an agent together with the decision recorded beside it. NOT a claim that the content is current, and NOT a claim that it is true. Known-old content that is labelled as such can be handoff-safe; an item whose date could not be established is blocked even when its content looks strong. The blocked state is unknown, not old.",
      decision:
        "How the item may be used, not how good it is. cite_as_primary, cite_as_supporting, use_as_background, needs_verification and exclude are usage instructions for the consuming agent.",
    },
    limitations: [
      "FreshContext does not certify truth.",
      "This evidence describes only the supplied candidate context and configured evaluation policy.",
      "A human engagement owner must review the evidence before issuing client conclusions.",
    ],
  });
  await writeText(join(output, "assessment-evidence.md"), toMarkdown(input, report, assessmentFindings));
  console.log(JSON.stringify({ ok: true, service: "context-integrity-assessment", output, total: report.summary.total, decisions: report.summary.decisions, handoff_safe: report.summary.handoff_safe, handoff_blocked: report.summary.handoff_blocked }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
