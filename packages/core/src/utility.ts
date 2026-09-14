import type {
  ContextUtilityInput,
  ContextUtilityResult,
  ContextUtilityStatus,
} from "./types.js";

const DATE_CONFIDENCE_FACTORS = {
  high: 1.0,
  medium: 0.75,
  low: 0.4,
  unknown: 0.0,
} as const;

const STATUS_FACTORS: Record<ContextUtilityStatus, number> = {
  success: 1.0,
  partial: 0.65,
  stale: 0.4,
  failed: 0.0,
  unknown: 0.5,
};

function clampRelevance(value: number, reasons: string[]): number {
  if (!Number.isFinite(value)) {
    reasons.push("contextual relevance was not finite; clamped to 0");
    return 0;
  }
  if (value > 100) {
    reasons.push("contextual relevance exceeded 100; clamped to 100");
    return 100;
  }
  if (value < 0) {
    reasons.push("contextual relevance was below 0; clamped to 0");
    return 0;
  }
  return value;
}

function safeLambda(value: number, reasons: string[]): number {
  if (!Number.isFinite(value) || value < 0) {
    reasons.push("lambda was invalid; clamped to 0");
    return 0;
  }
  return value;
}

function safeAgeHours(value: number, reasons: string[]): number {
  if (!Number.isFinite(value)) {
    reasons.push("ageHours was not finite; clamped to 0");
    return 0;
  }
  if (value < 0) {
    reasons.push("ageHours was negative; clamped to 0");
    return 0;
  }
  return value;
}

export function calculateContextUtility(input: ContextUtilityInput): ContextUtilityResult {
  const reasons: string[] = [];
  const contextualRelevance = clampRelevance(input.contextualRelevance, reasons);
  const lambda = safeLambda(input.lambda, reasons);
  const ageHours = safeAgeHours(input.ageHours, reasons);
  const dateConfidence = input.dateConfidence ?? "unknown";
  const status = input.status ?? "unknown";

  const decayFactor = Math.exp(-lambda * ageHours);
  const dateConfidenceFactor = DATE_CONFIDENCE_FACTORS[dateConfidence];
  const statusFactor = STATUS_FACTORS[status];

  if (dateConfidence === "medium") {
    reasons.push("timestamp confidence is medium; utility reduced");
  } else if (dateConfidence === "low") {
    reasons.push("timestamp confidence is low; utility reduced");
  } else if (dateConfidence === "unknown") {
    reasons.push("timestamp confidence is unknown; utility reduced to zero");
  }

  if (status === "partial") {
    reasons.push("signal status is partial; utility reduced");
  } else if (status === "stale") {
    reasons.push("signal status is stale; utility reduced");
  } else if (status === "failed") {
    reasons.push("signal status is failed; utility reduced to zero");
  } else if (status === "unknown") {
    reasons.push("signal status is unknown; utility reduced");
  }

  const score = Math.min(
    100,
    Math.max(0, contextualRelevance * decayFactor * dateConfidenceFactor * statusFactor)
  );

  return {
    score,
    contextualRelevance,
    decayFactor,
    dateConfidenceFactor,
    statusFactor,
    lambda,
    ageHours,
    status,
    reasons,
  };
}
