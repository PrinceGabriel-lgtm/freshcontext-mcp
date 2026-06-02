import { readFile } from "node:fs/promises";
import {
  evaluateSignals,
  getSourceProfile,
  interpretEvaluations,
} from "../src/core/index.js";
import type {
  ContextDecisionResult,
  CoreSignalEvaluationResult,
  FreshContextSignalInput,
  IntentProfileId,
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

interface SourceFileInput {
  profile: string;
  intent: IntentProfileId;
  signals: FreshContextSignalInput[];
}

function fail(message: string): never {
  console.error(`FreshContext input error: ${message}`);
  process.exit(1);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function assertStringField(value: Record<string, unknown>, field: string, index?: number): void {
  if (typeof value[field] !== "string" || value[field] === "") {
    const prefix = index === undefined ? "" : `signals[${index}].`;
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
  if (!isObject(value)) {
    fail(`signals[${index}] must be an object.`);
  }

  assertStringField(value, "source", index);
  assertOptionalStringOrNull(value, "title", index);
  assertOptionalStringOrNull(value, "content", index);
  assertOptionalStringOrNull(value, "source_type", index);
  assertOptionalStringOrNull(value, "published_at", index);
  assertOptionalStringOrNull(value, "content_date", index);
  assertOptionalStringOrNull(value, "retrieved_at", index);
  assertOptionalNumber(value, "semantic_score", index);

  return value as unknown as FreshContextSignalInput;
}

function validateInput(value: unknown): SourceFileInput {
  if (!isObject(value)) {
    fail("JSON root must be an object.");
  }

  assertStringField(value, "profile");
  assertStringField(value, "intent");

  if (!SUPPORTED_INTENTS.has(value.intent as IntentProfileId)) {
    fail(`intent "${String(value.intent)}" is not supported by this demo.`);
  }

  if (!Array.isArray(value.signals)) {
    fail("signals must be an array.");
  }
  if (value.signals.length === 0) {
    fail("signals must include at least one source.");
  }

  return {
    profile: value.profile as string,
    intent: value.intent as IntentProfileId,
    signals: value.signals.map(validateSignal),
  };
}

function pct(value: number | null | undefined): string {
  return typeof value === "number" ? String(value) : "null";
}

function score(value: number): string {
  return value.toFixed(3);
}

function printResult(
  result: CoreSignalEvaluationResult,
  decision: ContextDecisionResult,
  index: number
): void {
  console.log(`${index + 1}. ${result.signal.title ?? "Untitled source"}`);
  console.log(`   Decision: ${decision.label}`);
  console.log(`   Meaning: ${decision.meaning}`);
  console.log(`   Action: ${decision.action}`);

  if (decision.warnings.length > 0) {
    console.log(`   Warnings: ${decision.warnings.join("; ")}`);
  }

  console.log(`   Source: ${result.signal.source}`);
  console.log(`   Freshness: ${pct(result.freshness_score)}`);
  console.log(`   Rank score: ${score(result.ranked.final_score)}`);
  console.log(`   Utility: ${score(result.utility.score)}`);
  console.log(`   Confidence: ${result.ranked.confidence}`);
  console.log(`   Why: ${result.explanation}`);

  if (result.reasons.length > 0) {
    console.log(`   Signals: ${result.reasons.join("; ")}`);
  }
  console.log("");
}

async function main(): Promise<void> {
  const filePath = process.argv[2];
  if (!filePath) {
    fail("provide a JSON file path, for example: npm run demo:evaluate:file");
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

  const evaluations = evaluateSignals(input.signals, {
    defaultSourceType: profile.source_types[0],
  });
  const decisions = interpretEvaluations(evaluations, {
    sourceProfile: profile,
    intentProfile: input.intent,
  });

  console.log("FreshContext file evaluate demo");
  console.log("User-provided candidate context goes in; FreshContext returns decision-ready context.");
  console.log("");
  console.log(`Input: ${filePath}`);
  console.log(`Profile: ${profile.profile_id}`);
  console.log(`Intent: ${input.intent}`);
  console.log(`Purpose: ${profile.purpose}`);
  console.log("");
  console.log("Decision-ready context:");
  console.log("");

  evaluations.forEach((result, index) => printResult(result, decisions[index], index));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  fail(message);
});
