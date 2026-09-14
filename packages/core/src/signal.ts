import { isMeaningfullyFutureDate } from "./decay.js";
import { looksLikeFailedAdapterContent } from "./guards.js";
import type {
  ContextUtilityStatus,
  FreshContextSignal,
  FreshContextSignalInput,
  SignalDateConfidence,
  SignalNormalizeOptions,
} from "./types.js";

export const SIGNAL_CONTRACT_VERSION = "freshcontext.signal.v1" as const;

const DATE_CONFIDENCE_VALUES = new Set(["high", "medium", "low", "unknown"]);
const STATUS_VALUES = new Set(["success", "partial", "stale", "failed", "unknown"]);

function isSignalDateConfidence(value: unknown): value is SignalDateConfidence {
  return typeof value === "string" && DATE_CONFIDENCE_VALUES.has(value);
}

function isContextUtilityStatus(value: unknown): value is ContextUtilityStatus {
  return typeof value === "string" && STATUS_VALUES.has(value);
}

function normalizeDate(value: string | null | undefined): string | null {
  if (!value) return null;

  const timestamp = new Date(value).getTime();
  if (isNaN(timestamp)) return null;

  return new Date(timestamp).toISOString();
}

function resolveRetrievedAt(
  input: FreshContextSignalInput,
  options: SignalNormalizeOptions,
  reasons: string[]
): string {
  const retrievedAt = normalizeDate(input.retrieved_at);
  if (retrievedAt) return retrievedAt;

  if (input.retrieved_at) {
    reasons.push("retrieved_at was invalid; used normalization time");
  }

  const optionNow = options.now instanceof Date
    ? (isNaN(options.now.getTime()) ? null : options.now.toISOString())
    : normalizeDate(options.now);

  return optionNow ?? new Date().toISOString();
}

function normalizeSemanticScore(value: unknown, reasons: string[]): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    reasons.push("semantic_score was missing or invalid; clamped to 0");
    return 0;
  }
  if (value < 0) {
    reasons.push("semantic_score was below 0; clamped to 0");
    return 0;
  }
  if (value > 1) {
    reasons.push("semantic_score exceeded 1; clamped to 1");
    return 1;
  }
  return value;
}

function resolveDateConfidence(
  input: FreshContextSignalInput,
  hasTrustedDate: boolean
): SignalDateConfidence {
  if (!hasTrustedDate) return "unknown";
  if (isSignalDateConfidence(input.date_confidence)) return input.date_confidence;
  if (input.freshness_confidence) return input.freshness_confidence;
  return "medium";
}

function resolveStatus(input: FreshContextSignalInput, failedContent: boolean): ContextUtilityStatus {
  if (failedContent) return "failed";
  if (isContextUtilityStatus(input.status)) return input.status;
  return "success";
}

export function normalizeSignal(
  input: FreshContextSignalInput,
  options: SignalNormalizeOptions = {}
): FreshContextSignal {
  const reasons: string[] = [];
  const retrieved_at = resolveRetrievedAt(input, options, reasons);
  const rawPublishedAt = input.published_at ?? input.content_date ?? null;
  let published_at = normalizeDate(rawPublishedAt);

  if (!input.published_at && input.content_date) {
    reasons.push("content_date alias was normalized to published_at");
  }
  if (rawPublishedAt && !published_at) {
    reasons.push("published_at/content_date was invalid; cleared");
  }
  if (published_at && isMeaningfullyFutureDate(published_at, retrieved_at)) {
    published_at = null;
    reasons.push("published_at/content_date was meaningfully future-dated; cleared");
  }

  const failedContent = input.content !== undefined && looksLikeFailedAdapterContent(input.content);
  if (failedContent) {
    reasons.push("content looked like failed adapter output; status set to failed");
  }

  const source_type = input.source_type ?? options.defaultSourceType ?? "default";
  if (!input.source_type && !options.defaultSourceType) {
    reasons.push("source_type was missing; defaulted to default");
  }

  return {
    contract_version: SIGNAL_CONTRACT_VERSION,
    id: input.id,
    source: input.source,
    source_type,
    title: input.title,
    content: input.content,
    published_at,
    retrieved_at,
    semantic_score: normalizeSemanticScore(input.semantic_score, reasons),
    date_confidence: resolveDateConfidence(input, published_at !== null),
    status: resolveStatus(input, failedContent),
    metadata: input.metadata ? { ...input.metadata } : {},
    reasons,
  };
}
