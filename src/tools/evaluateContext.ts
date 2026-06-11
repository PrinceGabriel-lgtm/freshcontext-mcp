import {
  evaluateSignals,
  getSourceProfile,
  interpretEvaluations,
} from "../core/index.js";
import type {
  ContextDecisionResult,
  CoreSignalEvaluationOptions,
  CoreSignalEvaluationResult,
  FreshContextSignalInput,
  IntentProfileId,
  SourceProfile,
} from "../core/index.js";

const SUPPORTED_INTENTS: readonly IntentProfileId[] = [
  "citation_check",
  "student_research",
  "developer_adoption",
  "job_search",
  "market_watch",
  "business_due_diligence",
  "medical_literature_triage",
];

const MAX_CONTEXT_SIGNALS = 100;
const MAX_SOURCE_CHARS = 2048;
const MAX_TITLE_CHARS = 1000;
const MAX_CONTENT_CHARS = 50000;

export class EvaluateContextInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvaluateContextInputError";
  }
}

export interface EvaluateContextInput {
  profile: string;
  intent: string;
  signals: unknown;
  now?: string;
}

export interface EvaluateContextItem {
  evaluation: CoreSignalEvaluationResult;
  decision: ContextDecisionResult;
}

export interface EvaluateContextResult {
  profile: SourceProfile;
  intent: IntentProfileId;
  items: EvaluateContextItem[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIntentProfileId(value: string): value is IntentProfileId {
  return (SUPPORTED_INTENTS as readonly string[]).includes(value);
}

function assertMaxLength(value: unknown, field: string, maxLength: number, index?: number): void {
  if (typeof value === "string" && value.length > maxLength) {
    const prefix = index === undefined ? "" : `signals[${index}].`;
    throw new EvaluateContextInputError(`${prefix}${field} exceeds maximum length of ${maxLength} characters.`);
  }
}

function validateSignal(value: unknown, index: number): FreshContextSignalInput {
  if (!isRecord(value)) {
    throw new EvaluateContextInputError(`signals[${index}] must be an object.`);
  }
  if (typeof value.source !== "string" || value.source.trim().length === 0) {
    throw new EvaluateContextInputError(`signals[${index}].source must be a non-empty string.`);
  }
  assertMaxLength(value.source, "source", MAX_SOURCE_CHARS, index);
  assertMaxLength(value.title, "title", MAX_TITLE_CHARS, index);
  assertMaxLength(value.content, "content", MAX_CONTENT_CHARS, index);
  if (
    (typeof value.title !== "string" || value.title.trim().length === 0)
    && (typeof value.content !== "string" || value.content.trim().length === 0)
  ) {
    throw new EvaluateContextInputError(`signals[${index}] must include title or content.`);
  }
  return {
    ...value,
    source: value.source,
    title: typeof value.title === "string" ? value.title : undefined,
    content: typeof value.content === "string" ? value.content : undefined,
  } as FreshContextSignalInput;
}

export function evaluateContextInput(input: EvaluateContextInput): EvaluateContextResult {
  const profile = getSourceProfile(input.profile);
  if (!profile) {
    throw new EvaluateContextInputError(`Unknown source profile: ${input.profile}.`);
  }
  if (!isIntentProfileId(input.intent)) {
    throw new EvaluateContextInputError(`Unsupported intent profile: ${input.intent}.`);
  }
  if (!Array.isArray(input.signals)) {
    throw new EvaluateContextInputError("signals must be an array.");
  }
  if (input.signals.length === 0) {
    throw new EvaluateContextInputError("signals must contain at least one candidate context item.");
  }
  if (input.signals.length > MAX_CONTEXT_SIGNALS) {
    throw new EvaluateContextInputError(`signals must contain at most ${MAX_CONTEXT_SIGNALS} candidate context items.`);
  }
  if (input.now !== undefined && Number.isNaN(new Date(input.now).getTime())) {
    throw new EvaluateContextInputError("now must be a valid timestamp string when provided.");
  }

  const signals = input.signals.map(validateSignal);
  const options: CoreSignalEvaluationOptions = input.now ? { now: input.now } : {};
  const evaluations = evaluateSignals(signals, options);
  const decisions = interpretEvaluations(evaluations, {
    sourceProfile: profile,
    intentProfile: input.intent,
  });

  return {
    profile,
    intent: input.intent,
    items: evaluations.map((evaluation, index) => ({
      evaluation,
      decision: decisions[index],
    })),
  };
}

function sourceTitle(evaluation: CoreSignalEvaluationResult): string {
  if (evaluation.signal.title) return evaluation.signal.title;
  if (evaluation.signal.content) return evaluation.signal.content.slice(0, 80);
  return evaluation.signal.source;
}

function formatFreshness(score: number | null): string {
  return score === null ? "unknown" : `${Math.round(score)}/100`;
}

function formatRank(score: number): string {
  return score.toFixed(3);
}

function formatUtility(score: number): string {
  return `${Number(score.toFixed(1))}/100`;
}

function formatList(values: string[]): string {
  return values.length > 0 ? values.join("; ") : "None";
}

export function formatEvaluateContextResult(result: EvaluateContextResult): string {
  const lines: string[] = [
    "FreshContext evaluate_context",
    "Candidate context -> Core evaluation -> decision-ready context",
    "",
    `Profile: ${result.profile.profile_id}`,
    `Purpose: ${result.profile.purpose}`,
    `Intent: ${result.intent}`,
    "",
  ];

  result.items.forEach((item, index) => {
    const { evaluation, decision } = item;
    lines.push(
      `${index + 1}. ${sourceTitle(evaluation)}`,
      `   Decision: ${decision.label}`,
      `   Meaning: ${decision.meaning}`,
      `   Action: ${decision.action}`,
      `   Warnings: ${formatList(decision.warnings)}`,
      `   Source: ${evaluation.signal.source}`,
      `   Freshness: ${formatFreshness(evaluation.freshness_score)}`,
      `   Rank score: ${formatRank(evaluation.ranked.final_score)}`,
      `   Utility: ${formatUtility(evaluation.utility.score)}`,
      `   Confidence: ${evaluation.ranked.confidence}`,
      `   Why: ${evaluation.explanation}`,
      ""
    );
  });

  const structured = {
    profile: result.profile.profile_id,
    intent: result.intent,
    results: result.items.map((item, index) => ({
      index: index + 1,
      title: sourceTitle(item.evaluation),
      source: item.evaluation.signal.source,
      source_type: item.evaluation.signal.source_type,
      decision: item.decision.decision,
      label: item.decision.label,
      meaning: item.decision.meaning,
      action: item.decision.action,
      warnings: item.decision.warnings,
      reasons: item.decision.reasons,
      freshness_score: item.evaluation.freshness_score,
      rank_score: item.evaluation.ranked.final_score,
      utility_score: item.evaluation.utility.score,
      confidence: item.evaluation.ranked.confidence,
      why: item.evaluation.explanation,
    })),
  };

  lines.push(
    "[FRESHCONTEXT_EVALUATION_JSON]",
    JSON.stringify(structured, null, 2),
    "[/FRESHCONTEXT_EVALUATION_JSON]"
  );

  return lines.join("\n");
}
