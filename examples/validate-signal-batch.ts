import { readFile, stat } from "node:fs/promises";
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
  SourceProfile,
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

const SUPPORTED_DECISIONS = new Set<ContextDecision>([
  "use_first",
  "cite_as_primary",
  "cite_as_supporting",
  "use_as_background",
  "needs_verification",
  "needs_refresh",
  "watch_only",
  "exclude",
]);

const MAX_BATCH_FILE_BYTES = 1024 * 1024;
const MAX_BATCH_SIGNALS = 500;
const MAX_SOURCE_CHARS = 2048;
const MAX_TITLE_CHARS = 1000;
const MAX_CONTENT_CHARS = 100000;

type ReviewableSignalInput = FreshContextSignalInput & {
  expected_decision?: ContextDecision;
  review_note?: string;
};

type ExplanationReasonCode =
  | "strong_semantic_match"
  | "low_semantic_match"
  | "fresh_for_profile"
  | "stale_for_profile"
  | "missing_published_at"
  | "invalid_published_at"
  | "future_published_at_rejected"
  | "low_date_confidence"
  | "status_partial"
  | "status_failed"
  | "utility_reduced"
  | "failed_content_detected"
  | "semantic_score_clamped"
  | "source_profile_applied"
  | "background_only"
  | "verification_recommended"
  | "refresh_recommended";

interface BatchInput {
  profile: string;
  intent: IntentProfileId;
  now?: string;
  signals: ReviewableSignalInput[];
}

interface HumanReviewMismatch {
  index: number;
  title: string;
  source: string;
  expected_decision: ContextDecision;
  actual_decision: ContextDecision;
  review_note: string;
  reason_codes: ExplanationReasonCode[];
  reason: string;
}

interface HumanReviewSummary {
  labeled_signals: number;
  unlabeled_signals: number;
  label_match_count: number;
  label_mismatch_count: number;
  label_match_rate: number | null;
  mismatches: HumanReviewMismatch[];
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
  human_review: HumanReviewSummary;
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
    reason_codes: ExplanationReasonCode[];
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

function assertMaxLength(value: Record<string, unknown>, field: string, maxLength: number, index: number): void {
  if (typeof value[field] === "string" && value[field].length > maxLength) {
    fail(`signals[${index}].${field} exceeds maximum length of ${maxLength} characters.`);
  }
}

function validateSignal(value: unknown, index: number): ReviewableSignalInput {
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
  assertOptionalStringOrNull(value, "review_note", index);
  assertOptionalNumber(value, "semantic_score", index);
  assertMaxLength(value, "source", MAX_SOURCE_CHARS, index);
  assertMaxLength(value, "title", MAX_TITLE_CHARS, index);
  assertMaxLength(value, "content", MAX_CONTENT_CHARS, index);

  if (value.expected_decision !== undefined) {
    if (typeof value.expected_decision !== "string" || !SUPPORTED_DECISIONS.has(value.expected_decision as ContextDecision)) {
      fail(`signals[${index}].expected_decision must be a supported FreshContext decision label.`);
    }
  }

  const hasTitle = typeof value.title === "string" && value.title.trim().length > 0;
  const hasContent = typeof value.content === "string" && value.content.trim().length > 0;
  if (!hasTitle && !hasContent) {
    fail(`signals[${index}] must include title or content.`);
  }

  return value as unknown as ReviewableSignalInput;
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
  if (value.signals.length > MAX_BATCH_SIGNALS) {
    fail(`signals must include at most ${MAX_BATCH_SIGNALS} candidate context items.`);
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

function uniqueReasonCodes(codes: ExplanationReasonCode[]): ExplanationReasonCode[] {
  return [...new Set(codes)];
}

function explanationReasonCodes(
  result: CoreSignalEvaluationResult,
  decision: ContextDecisionResult,
  profile: SourceProfile
): ExplanationReasonCode[] {
  const codes: ExplanationReasonCode[] = ["source_profile_applied"];
  const signalReasons = result.signal.reasons.join(" ");
  const utilityReasons = result.utility.reasons.join(" ");

  if (result.signal.semantic_score >= 0.85) codes.push("strong_semantic_match");
  if (result.signal.semantic_score <= 0.35) codes.push("low_semantic_match");

  if (result.freshness_score !== null && result.freshness_score >= 70) {
    codes.push("fresh_for_profile");
  }
  if (result.freshness_score !== null && result.freshness_score < 50) {
    codes.push("stale_for_profile");
  }

  if (result.signal.published_at === null) codes.push("missing_published_at");
  if (/invalid; cleared/.test(signalReasons)) codes.push("invalid_published_at");
  if (/future-dated; cleared/.test(signalReasons)) codes.push("future_published_at_rejected");
  if (result.signal.date_confidence === "unknown" || result.signal.date_confidence === "low") {
    codes.push("low_date_confidence");
  }

  if (result.signal.status === "partial") codes.push("status_partial");
  if (result.signal.status === "failed") codes.push("status_failed");
  if (/failed adapter output/.test(signalReasons)) codes.push("failed_content_detected");
  if (/semantic_score .*clamped/.test(signalReasons)) codes.push("semantic_score_clamped");
  if (result.utility.score < 30 || /utility reduced/.test(utilityReasons)) codes.push("utility_reduced");

  if (decision.decision === "use_as_background" || decision.decision === "cite_as_supporting") {
    codes.push("background_only");
  }
  if (decision.decision === "needs_verification") codes.push("verification_recommended");
  if (decision.decision === "needs_refresh") codes.push("refresh_recommended");

  if (profile.profile_id === "jobs_opportunities" && result.freshness_score !== null && result.freshness_score < 70) {
    codes.push("refresh_recommended");
  }

  return uniqueReasonCodes(codes);
}

function buildReadableExplanation(
  result: CoreSignalEvaluationResult,
  decision: ContextDecisionResult,
  profile: SourceProfile,
  reasonCodes: ExplanationReasonCode[]
): string {
  const factors: string[] = [];

  if (reasonCodes.includes("status_failed")) {
    factors.push("failed or error-looking content was excluded from freshness and utility treatment");
  } else if (reasonCodes.includes("future_published_at_rejected")) {
    factors.push("a future-dated timestamp was rejected, reducing date confidence");
  } else if (reasonCodes.includes("invalid_published_at")) {
    factors.push("the published timestamp was invalid, so date confidence is reduced");
  } else if (reasonCodes.includes("missing_published_at")) {
    factors.push("the publication date is missing, so current-use confidence is limited");
  } else if (reasonCodes.includes("stale_for_profile")) {
    factors.push(`the source is stale for the ${profile.profile_id} profile`);
  } else if (reasonCodes.includes("fresh_for_profile")) {
    factors.push(`the source is fresh for the ${profile.profile_id} profile`);
  }

  if (reasonCodes.includes("strong_semantic_match")) {
    factors.push("semantic relevance is strong");
  } else if (reasonCodes.includes("low_semantic_match")) {
    factors.push("semantic relevance is weak");
  }

  if (reasonCodes.includes("semantic_score_clamped")) {
    factors.push("the caller-provided semantic score was clamped into the valid 0..1 range");
  }

  if (reasonCodes.includes("utility_reduced")) {
    factors.push(`utility is reduced to ${formatScore(result.utility.score)}`);
  }

  const factorText = factors.length > 0
    ? factors.join("; ")
    : result.explanation;

  return `${decision.label}: ${decision.action} FreshContext chose this treatment because ${factorText}.`;
}

function buildHumanReview(
  input: BatchInput,
  evaluations: CoreSignalEvaluationResult[],
  decisions: ContextDecisionResult[],
  profile: SourceProfile
): HumanReviewSummary {
  const reviewBySource = new Map<string, {
    index: number;
    expected_decision: ContextDecision;
    review_note: string;
  }>();

  input.signals.forEach((signal, index) => {
    if (signal.expected_decision) {
      reviewBySource.set(signal.source, {
        index: index + 1,
        expected_decision: signal.expected_decision,
        review_note: signal.review_note ?? "",
      });
    }
  });

  const mismatches: HumanReviewMismatch[] = [];
  let labelMatchCount = 0;

  evaluations.forEach((result, index) => {
    const review = reviewBySource.get(result.signal.source);
    if (!review) return;

    const actualDecision = decisions[index].decision;
    if (actualDecision === review.expected_decision) {
      labelMatchCount += 1;
      return;
    }

    const reasonCodes = explanationReasonCodes(result, decisions[index], profile);
    mismatches.push({
      index: review.index,
      title: sourceTitle(result),
      source: result.signal.source,
      expected_decision: review.expected_decision,
      actual_decision: actualDecision,
      review_note: review.review_note,
      reason_codes: reasonCodes,
      reason: buildReadableExplanation(
        result,
        decisions[index],
        profile,
        reasonCodes
      ),
    });
  });

  const labeledSignals = reviewBySource.size;

  return {
    labeled_signals: labeledSignals,
    unlabeled_signals: input.signals.length - labeledSignals,
    label_match_count: labelMatchCount,
    label_mismatch_count: mismatches.length,
    label_match_rate: labeledSignals > 0
      ? Number((labelMatchCount / labeledSignals).toFixed(3))
      : null,
    mismatches,
  };
}

function buildReport(
  filePath: string,
  input: BatchInput,
  evaluations: CoreSignalEvaluationResult[],
  decisions: ContextDecisionResult[],
  profile: SourceProfile
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
    human_review: buildHumanReview(input, evaluations, decisions, profile),
    top_results: evaluations.slice(0, 5).map((result, index) => {
      const reasonCodes = explanationReasonCodes(result, decisions[index], profile);
      return {
        rank: index + 1,
        title: sourceTitle(result),
        source: result.signal.source,
        decision: decisions[index].decision,
        label: decisions[index].label,
        freshness_score: result.freshness_score,
        rank_score: result.ranked.final_score,
        utility_score: result.utility.score,
        confidence: result.ranked.confidence,
        reason_codes: reasonCodes,
        warnings: decisions[index].warnings,
        why: buildReadableExplanation(result, decisions[index], profile, reasonCodes),
      };
    }),
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
  console.log(
    `Human review: labeled ${report.human_review.labeled_signals}; `
    + `unlabeled ${report.human_review.unlabeled_signals}; `
    + `matches ${report.human_review.label_match_count}; `
    + `mismatches ${report.human_review.label_mismatch_count}; `
    + `match rate ${report.human_review.label_match_rate === null ? "n/a" : report.human_review.label_match_rate}`
  );
  if (report.human_review.mismatches.length > 0) {
    console.log("Human review mismatches:");
    report.human_review.mismatches.forEach((mismatch) => {
      console.log(`- ${mismatch.index}. ${mismatch.title}`);
      console.log(`  Expected: ${mismatch.expected_decision}`);
      console.log(`  Actual: ${mismatch.actual_decision}`);
      if (mismatch.review_note) {
        console.log(`  Review note: ${mismatch.review_note}`);
      }
      console.log(`  Reason codes: ${mismatch.reason_codes.join(", ")}`);
      console.log(`  Why: ${mismatch.reason}`);
    });
  }
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
    console.log(`   Reason codes: ${result.reason_codes.join(", ")}`);
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
    const info = await stat(filePath);
    if (!info.isFile()) {
      fail(`"${filePath}" is not a file.`);
    }
    if (info.size > MAX_BATCH_FILE_BYTES) {
      fail(`"${filePath}" exceeds maximum batch file size of ${MAX_BATCH_FILE_BYTES} bytes.`);
    }
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

  printReport(buildReport(filePath, input, evaluations, decisions, profile));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  fail(message);
});
