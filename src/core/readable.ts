import type {
  ContextDecision,
  ContextDecisionResult,
  CoreSignalEvaluationResult,
  HumanReadableContextResult,
} from "./types.js";

const MAX_READABLE_REASONS = 5;

const READER_LABELS: Record<ContextDecision, string> = {
  use_first: "Use first",
  cite_as_primary: "Primary source",
  cite_as_supporting: "Supporting source",
  use_as_background: "Background only",
  needs_verification: "Needs verification",
  needs_refresh: "Needs refresh",
  watch_only: "Watch only",
  exclude: "Excluded",
};

const SUMMARIES: Record<ContextDecision, string> = {
  use_first: "This source is strong enough to use early in the context bundle.",
  cite_as_primary: "This source is strong enough to use as main evidence.",
  cite_as_supporting: "This source is useful as supporting evidence.",
  use_as_background: "This source is useful as background, but should not carry the main claim.",
  needs_verification: "This source may be relevant, but timing, origin, or confidence needs checking.",
  needs_refresh: "This source may be outdated for the current task and should be refreshed.",
  watch_only: "This source may be related, but is too weak to rely on directly.",
  exclude: "This source should not be included as trusted context.",
};

const ACTIONS: Record<ContextDecision, string> = {
  use_first: "Use this near the front of the selected context while preserving provenance.",
  cite_as_primary: "Use this as main evidence while preserving citation and provenance.",
  cite_as_supporting: "Use this to support or qualify the answer, not as the only source.",
  use_as_background: "Keep this as background context only.",
  needs_verification: "Do not use this as primary evidence until it is checked.",
  needs_refresh: "Look for a newer source before using this as current evidence.",
  watch_only: "Do not rely on this directly; keep it for monitoring or review.",
  exclude: "Keep this out of the final model context unless a human reviews it.",
};

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export function toReadableContextResult(
  evaluation: CoreSignalEvaluationResult,
  decision: ContextDecisionResult
): HumanReadableContextResult {
  const why = unique([
    ...decision.reasons,
    evaluation.explanation,
  ]).slice(0, MAX_READABLE_REASONS);

  return {
    label: READER_LABELS[decision.decision],
    summary: SUMMARIES[decision.decision],
    why,
    action: ACTIONS[decision.decision],
    warnings: [...decision.warnings],
  };
}
