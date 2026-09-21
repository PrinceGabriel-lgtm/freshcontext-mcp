import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { evaluateContextInput } from "../src/tools/evaluateContext.js";
import { toReadableContextResult } from "../packages/core/src/index.js";

export interface WorkflowInput {
  application_ref?: string;
  workflow_id?: string;
  workflow_name?: string;
  profile: string;
  intent: string;
  now?: string;
  signals: unknown[];
}

export interface EvaluatedItem {
  index: number;
  id: string | null;
  title: string | null;
  source: string;
  source_type: string;
  decision: string;
  label: string;
  action: string;
  warnings: string[];
  reasons: string[];
  freshness_score: number | null;
  rank_score: number;
  utility_score: number;
  confidence: string;
  provenance_state: string;
  safe_for_agent_handoff: boolean;
  why: string;
}

export interface EvaluationSummary {
  total: number;
  decisions: Record<string, number>;
  handoff_safe: number;
  handoff_blocked: number;
  freshness_unknown: number;
  provenance_incomplete: number;
  low_confidence: number;
}

export interface EvaluatedWorkflow {
  workflow_id: string | null;
  workflow_name: string | null;
  profile: string;
  intent: string;
  now: string | null;
  summary: EvaluationSummary;
  items: EvaluatedItem[];
}

export async function readJsonFile<T = unknown>(path: string): Promise<T> {
  const raw = await readFile(resolve(path), "utf8");
  try {
    return JSON.parse(raw) as T;
  } catch (error) {
    throw new Error(`Invalid JSON in ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function writeText(path: string, content: string): Promise<void> {
  const target = resolve(path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content.endsWith("\n") ? content : content + "\n", "utf8");
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await writeText(path, JSON.stringify(value, null, 2));
}

function sourceTitle(signal: { title?: string; content?: string; source: string }): string | null {
  if (signal.title) return signal.title;
  if (signal.content) return signal.content.slice(0, 120);
  return signal.source || null;
}

export function evaluateWorkflow(input: WorkflowInput): EvaluatedWorkflow {
  const result = evaluateContextInput({
    profile: input.profile,
    intent: input.intent,
    signals: input.signals,
    ...(input.now ? { now: input.now } : {}),
  });

  const items: EvaluatedItem[] = result.items.map((item, index) => {
    const readable = toReadableContextResult(item.evaluation, item.decision);
    const signal = item.evaluation.signal;
    return {
      index: index + 1,
      id: typeof signal.id === "string" ? signal.id : null,
      title: sourceTitle(signal),
      source: signal.source,
      source_type: signal.source_type,
      decision: item.decision.decision,
      label: item.decision.label,
      action: item.decision.action,
      warnings: item.decision.warnings,
      reasons: item.decision.reasons,
      freshness_score: item.evaluation.freshness_score,
      rank_score: item.evaluation.ranked.final_score,
      utility_score: item.evaluation.utility.score,
      confidence: item.evaluation.ranked.confidence,
      provenance_state: item.evaluation.provenance_readiness.state,
      safe_for_agent_handoff: readable.handoff.safe_for_agent_handoff,
      why: item.evaluation.explanation,
    };
  });

  const decisions: Record<string, number> = {};
  for (const item of items) decisions[item.decision] = (decisions[item.decision] ?? 0) + 1;

  return {
    workflow_id: input.workflow_id ?? null,
    workflow_name: input.workflow_name ?? null,
    profile: result.profile.profile_id,
    intent: result.intent,
    now: input.now ?? null,
    summary: {
      total: items.length,
      decisions,
      handoff_safe: items.filter((item) => item.safe_for_agent_handoff).length,
      handoff_blocked: items.filter((item) => !item.safe_for_agent_handoff).length,
      freshness_unknown: items.filter((item) => item.freshness_score === null).length,
      provenance_incomplete: items.filter((item) => item.provenance_state !== "complete").length,
      low_confidence: items.filter((item) => item.confidence === "low").length,
    },
    items,
  };
}

export function markdownTable(rows: string[][]): string {
  if (rows.length === 0) return "";
  const head = rows[0];
  const sep = head.map(() => "---");
  const render = (row: string[]) =>
    "| " + row.map((cell) => String(cell).replaceAll("|", "\\|").replaceAll("\n", " ")).join(" | ") + " |";
  return [render(head), render(sep), ...rows.slice(1).map(render)].join("\n");
}

export function formatDecisionCounts(counts: Record<string, number>): string {
  return Object.entries(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([decision, count]) => `${decision}: ${count}`)
    .join(", ");
}

export function usageError(message: string): never {
  console.error(message);
  process.exit(1);
}
