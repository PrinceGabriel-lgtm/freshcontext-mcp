import { readFile } from "node:fs/promises";
import {
  evaluateSignals,
  getSourceProfile,
  interpretEvaluations,
} from "../src/core/index.js";
import type {
  ContextDecision,
  ContextDecisionResult,
  ContextUtilityStatus,
  CoreSignalEvaluationOptions,
  CoreSignalEvaluationResult,
  FreshContextSignalInput,
  IntentProfileId,
  SignalDateConfidence,
} from "../src/core/index.js";

const SUPPORTED_INTENTS = new Set<IntentProfileId>([
  "citation_check",
  "student_research",
  "developer_adoption",
  "job_search",
  "market_watch",
  "business_due_diligence",
  "medical_literature_triage",
]);

interface BatchInput {
  profile: string;
  intent: IntentProfileId;
  now?: string;
  signals: FreshContextSignalInput[];
}

interface BatchReport {
  input: string;
  profile: string;
  intent: IntentProfileId;
  total_signals: number;
  status_counts: Record<string, number>;
  date_confidence_counts: Record<string, number>;
  decision_counts: Record<string, number>;
  anomaly_counts: {
    missing_date: number;
    invalid_timestamp: number;
    future_timestamp: number;
    clamped_semantic_score: number;
    failed_status: number;
  };
  top_results: Array<{
    rank: number;
    title: string;
    source: string;
    decision: ContextDecision;
    label: string;
    freshness_score: number | null;
    rank_score: number;
    utility_score: number;
    confidence: string;
    warnings: string[];
    why: string;
  }>;
}

function fail(message: string): never {
  console.error(`FreshContext batch validation error: ${message}`);
  process.exit(1);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertStringField(value: Record<string, unknown>, field: string, prefix = ""): void {
  if (typeof value[field] !== "string" || value[field] === "") {
    fail(`${prefix}${field} must be a non-empty string.`);
  }
}

function assertOptionalStringOrNull(value: Record<string, unknown>, field: string, index: number): void {
  if (value[field] !== undefined && value[field] !== null && typeof value[field] !== "string") {
    fail(`signals[${index}].${field} must be a string or null when provided.`);
  }
}

function assertOptionalNumber(value: Record<string, unknown>, field: string, index: number): void {
  if (value[field] !== undefined && typeof value[field] !== "number") {
    fail(`signals[${index}].${field} must be a number when provided.`);
  }
}

function validateSignal(value: unknown, index: number): FreshContextSignalInput {
  if (!isRecord(value)) {
    fail(`signals[${index}] must be an object.`);
  }

  assertStringField(value, "source", `signals[${index}].`);
  assertOptionalStringOrNull(value, "title", index);
  assertOptionalStringOrNull(value, "content", index);
  assertOptionalStringOrNull(value, "source_type", index);
  assertOptionalStringOrNull(value, "published_at", index);
  assertOptionalStringOrNull(value, "content_date", index);
  assertOptionalStringOrNull(value, "retrieved_at", index);
  assertOptionalNumber(value, "semantic_score", index);

  const hasTitle = typeof value.title === "string" && value.title.trim().length > 0;
  const hasContent = typeof value.content === "string" && value.content.trim().length > 0;
  if (!hasTitle && !hasContent) {
    fail(`signals[${index}] must include title or content.`);
  }

  return value as unknown as FreshContextSignalInput;
}

function validateInput(value: unknown): BatchInput {
  if (!isRecord(value)) {
    fail("JSON root must be an object.");
  }

  assertStringField(value, "profile");
  assertStringField(value, "intent");

  if (!SUPPORTED_INTENTS.has(value.intent as IntentProfileId)) {
    fail(`intent "${String(value.intent)}" is not supported by this batch harness.`);
  }

  if (value.now !== undefined) {
    if (typeof value.now !== "string" || Number.isNaN(new Date(value.now).getTime())) {
      fail("now must be a valid timestamp string when provided.");
    }
  }

  if (!Array.isArray(value.signals)) {
    fail("signals must be an array.");
  }
  if (value.signals.length === 0) {
    fail("signals must include at least one candidate context item.");
  }

  return {
    profile: value.profile as string,
    intent: value.intent as IntentProfileId,
    now: value.now as string | undefined,
    signals: value.signals.map(validateSignal),
  };
}

function increment<T extends string>(counts: Record<T, number>, key: T): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

function hasReason(result: CoreSignalEvaluationResult, pattern: RegExp): boolean {
  return result.signal.reasons.some((reason) => pattern.test(reason));
}

function sourceTitle(result: CoreSignalEvaluationResult): string {
  return result.signal.title ?? result.signal.content?.slice(0, 80) ?? result.signal.source;
}

function formatScore(value: number): string {
  return value.toFixed(3);
}

function buildReport(
  filePath: string,
  input: BatchInput,
  evaluations: CoreSignalEvaluationResult[],
  decisions: ContextDecisionResult[]
): BatchReport {
  const statusCounts: Record<ContextUtilityStatus, number> = {
    success: 0,
    partial: 0,
    stale: 0,
    failed: 0,
    unknown: 0,
  };
  const dateConfidenceCounts: Record<SignalDateConfidence, number> = {
    high: 0,
    medium: 0,
    low: 0,
    unknown: 0,
  };
  const decisionCounts: Record<ContextDecision, number> = {
    use_first: 0,
    cite_as_primary: 0,
    cite_as_supporting: 0,
    use_as_background: 0,
    needs_verification: 0,
    needs_refresh: 0,
    watch_only: 0,
    exclude: 0,
  };

  let missingDate = 0;
  let invalidTimestamp = 0;
  let futureTimestamp = 0;
  let clampedSemanticScore = 0;

  evaluations.forEach((result, index) => {
    increment(statusCounts, result.signal.status);
    increment(dateConfidenceCounts, result.signal.date_confidence);
    increment(decisionCounts, decisions[index].decision);

    const original = input.signals[index];
    if (!original.published_at && !original.content_date) {
      missingDate += 1;
    }
    if (hasReason(result, /invalid; cleared/)) {
      invalidTimestamp += 1;
    }
    if (hasReason(result, /future-dated; cleared/)) {
      futureTimestamp += 1;
    }
    if (hasReason(result, /semantic_score .*clamped/)) {
      clampedSemanticScore += 1;
    }
  });

  return {
    input: filePath,
    profile: input.profile,
    intent: input.intent,
    total_signals: evaluations.length,
    status_counts: statusCounts,
    date_confidence_counts: dateConfidenceCounts,
    decision_counts: decisionCounts,
    anomaly_counts: {
      missing_date: missingDate,
      invalid_timestamp: invalidTimestamp,
      future_timestamp: futureTimestamp,
      clamped_semantic_score: clampedSemanticScore,
      failed_status: statusCounts.failed,
    },
    top_results: evaluations.slice(0, 5).map((result, index) => ({
      rank: index + 1,
      title: sourceTitle(result),
      source: result.signal.source,
      decision: decisions[index].decision,
      label: decisions[index].label,
      freshness_score: result.freshness_score,
      rank_score: result.ranked.final_score,
      utility_score: result.utility.score,
      confidence: result.ranked.confidence,
      warnings: decisions[index].warnings,
      why: result.explanation,
    })),
  };
}

function printCounts(title: string, counts: Record<string, number>): void {
  const rendered = Object.entries(counts)
    .filter(([, value]) => value > 0)
    .map(([key, value]) => `${key}: ${value}`)
    .join("; ");
  console.log(`${title}: ${rendered || "none"}`);
}

function printReport(report: BatchReport): void {
  console.log("FreshContext Signal Contract batch validation");
  console.log("Candidate context batch -> Core evaluation -> decision-ready context");
  console.log("");
  console.log(`Input: ${report.input}`);
  console.log(`Profile: ${report.profile}`);
  console.log(`Intent: ${report.intent}`);
  console.log(`Total signals: ${report.total_signals}`);
  console.log("");
  printCounts("Status counts", report.status_counts);
  printCounts("Date confidence counts", report.date_confidence_counts);
  printCounts("Decision counts", report.decision_counts);
  printCounts("Anomaly counts", report.anomaly_counts);
  console.log("");
  console.log("Top decision-ready results:");
  report.top_results.forEach((result) => {
    console.log(`${result.rank}. ${result.title}`);
    console.log(`   Decision: ${result.label}`);
    console.log(`   Source: ${result.source}`);
    console.log(`   Freshness: ${result.freshness_score === null ? "unknown" : `${Math.round(result.freshness_score)}/100`}`);
    console.log(`   Rank score: ${formatScore(result.rank_score)}`);
    console.log(`   Utility: ${formatScore(result.utility_score)}`);
    console.log(`   Confidence: ${result.confidence}`);
    console.log(`   Why: ${result.why}`);
    if (result.warnings.length > 0) {
      console.log(`   Warnings: ${result.warnings.join("; ")}`);
    }
  });
  console.log("");
  console.log("[FRESHCONTEXT_BATCH_JSON]");
  console.log(JSON.stringify(report, null, 2));
  console.log("[/FRESHCONTEXT_BATCH_JSON]");
}

async function main(): Promise<void> {
  const filePath = process.argv.slice(2).pop();
  if (!filePath) {
    fail("provide a JSON file path, for example: npm run batch:validate -- examples/batches/signal-contract-v1.academic.json");
  }

  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(`could not read "${filePath}": ${message}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    fail(`could not parse JSON in "${filePath}": ${message}`);
  }

  const input = validateInput(parsed);
  const profile = getSourceProfile(input.profile);
  if (!profile) {
    fail(`profile "${input.profile}" is not a built-in Source Profile.`);
  }

  const options: CoreSignalEvaluationOptions = {
    defaultSourceType: profile.source_types[0],
    ...(input.now ? { now: input.now } : {}),
  };
  const evaluations = evaluateSignals(input.signals, options);
  const decisions = interpretEvaluations(evaluations, {
    sourceProfile: profile,
    intentProfile: input.intent,
  });

  printReport(buildReport(filePath, input, evaluations, decisions));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  fail(message);
});
