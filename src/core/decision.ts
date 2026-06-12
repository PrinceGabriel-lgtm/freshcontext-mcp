import { getSourceProfile } from "./sourceProfiles.js";
import type {
  ContextDecision,
  ContextDecisionOptions,
  ContextDecisionResult,
  CoreSignalEvaluationResult,
  IntentProfileId,
  SourceProfile,
  SourceProfileId,
} from "./types.js";

const CITATION_INTENTS = new Set<IntentProfileId>(["citation_check", "student_research"]);
const STRICT_REFRESH_PROFILES = new Set<SourceProfileId>(["market_finance", "jobs_opportunities"]);

function resolveSourceProfile(profile: ContextDecisionOptions["sourceProfile"]): SourceProfile | undefined {
  if (!profile) return undefined;
  return typeof profile === "string" ? getSourceProfile(profile) : profile;
}

function profileId(profile: SourceProfile | undefined): SourceProfileId | undefined {
  return profile?.profile_id;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function hasFailureReason(evaluation: CoreSignalEvaluationResult): boolean {
  return evaluation.reasons.some((reason) => /\b(?:failed|failure|timeout|error|blocked|upstream)\b/i.test(reason));
}

function isCitationIntent(intent: IntentProfileId | undefined): boolean {
  return intent !== undefined && CITATION_INTENTS.has(intent);
}

function nonAdviceWarnings(intent: IntentProfileId | undefined): string[] {
  switch (intent) {
    case "citation_check":
    case "student_research":
      return ["FreshContext judges citation readiness and context usefulness; it does not certify truth."];
    case "medical_literature_triage":
      return ["FreshContext provides literature triage only; it is not medical advice."];
    case "market_watch":
      return ["FreshContext provides market signal triage only; it is not investment advice."];
    case "business_due_diligence":
      return ["FreshContext supports context triage only; it is not legal, tax, or investment advice."];
    case "job_search":
      return ["FreshContext provides opportunity triage only; it is not employment or legal advice."];
    default:
      return [];
  }
}

function decisionResult(
  decision: ContextDecision,
  reasons: string[],
  warnings: string[]
): ContextDecisionResult {
  const copyReasons = unique(reasons);
  const copyWarnings = unique(warnings);

  switch (decision) {
    case "use_first":
      return {
        decision,
        label: "Use first",
        meaning: "This is strong, current context for the task.",
        action: "Use this near the top of the context bundle.",
        reasons: copyReasons,
        warnings: copyWarnings,
      };
    case "cite_as_primary":
      return {
        decision,
        label: "Cite as primary",
        meaning: "This source is relevant, current, and traceable enough to use as main evidence.",
        action: "Use it as primary citation evidence, while keeping normal source-review standards.",
        reasons: copyReasons,
        warnings: copyWarnings,
      };
    case "cite_as_supporting":
      return {
        decision,
        label: "Cite as supporting",
        meaning: "This source is useful evidence, but should not be the only or latest support.",
        action: "Use it as supporting evidence and pair it with stronger or newer sources.",
        reasons: copyReasons,
        warnings: copyWarnings,
      };
    case "use_as_background":
      return {
        decision,
        label: "Use as background",
        meaning: "This source is relevant context, but not strong enough for latest-evidence claims.",
        action: "Use it for framing, history, or background rather than as the main current source.",
        reasons: copyReasons,
        warnings: copyWarnings,
      };
    case "needs_verification":
      return {
        decision,
        label: "Needs verification",
        meaning: "This source may be useful, but its date, confidence, or traceability is uncertain.",
        action: "Verify the source details before citing it, acting on it, or sending it to a model as trusted context.",
        reasons: copyReasons,
        warnings: copyWarnings,
      };
    case "needs_refresh":
      return {
        decision,
        label: "Needs refresh",
        meaning: "This source may be useful, but it is too stale or date-uncertain for this source type.",
        action: "Refresh or re-query this source before relying on it as current context.",
        reasons: copyReasons,
        warnings: copyWarnings,
      };
    case "watch_only":
      return {
        decision,
        label: "Watch only",
        meaning: "This is an interesting signal, but not strong enough to prioritize.",
        action: "Monitor it or keep it as a weak signal; do not use it as main evidence.",
        reasons: copyReasons,
        warnings: copyWarnings,
      };
    case "exclude":
      return {
        decision,
        label: "Exclude",
        meaning: "This source is failed, too weak, or unsafe to include as useful context.",
        action: "Keep it out of the final context bundle unless a human explicitly reviews it.",
        reasons: copyReasons,
        warnings: copyWarnings,
      };
  }
}

export function interpretEvaluation(
  evaluation: CoreSignalEvaluationResult,
  options: ContextDecisionOptions = {}
): ContextDecisionResult {
  const sourceProfile = resolveSourceProfile(options.sourceProfile);
  const sourceProfileId = profileId(sourceProfile);
  const intentProfile = options.intentProfile;
  const reasons = unique([
    evaluation.explanation,
    ...evaluation.signal.reasons,
    ...evaluation.utility.reasons,
    ...evaluation.reasons,
  ]);
  const warnings = [...nonAdviceWarnings(intentProfile)];
  const finalScore = evaluation.ranked.final_score;
  const freshnessScore = evaluation.freshness_score;
  const confidence = evaluation.ranked.confidence;
  const isFailed = evaluation.signal.status === "failed"
    || (confidence === "low" && hasFailureReason(evaluation));

  if (sourceProfile) {
    reasons.push(`source profile ${sourceProfile.profile_id} uses ${sourceProfile.date_policy} date policy`);
  }
  if (intentProfile) {
    reasons.push(`intent profile ${intentProfile} selected`);
  }

  if (isFailed) {
    return decisionResult("exclude", reasons, warnings);
  }

  if (
    sourceProfileId
    && STRICT_REFRESH_PROFILES.has(sourceProfileId)
    && (freshnessScore === null || freshnessScore < 50)
  ) {
    return decisionResult("needs_refresh", reasons, warnings);
  }

  if (evaluation.signal.date_confidence === "unknown") {
    if (sourceProfileId === "academic_research" && finalScore >= 0.75) {
      return decisionResult(isCitationIntent(intentProfile) ? "cite_as_supporting" : "use_as_background", reasons, warnings);
    }
    return decisionResult("needs_verification", reasons, warnings);
  }

  if (
    finalScore >= 0.85
    && freshnessScore !== null
    && freshnessScore >= 70
    && confidence === "high"
  ) {
    if (sourceProfile?.authority_hint === "high" && isCitationIntent(intentProfile)) {
      return decisionResult("cite_as_primary", reasons, warnings);
    }
    return decisionResult("use_first", reasons, warnings);
  }

  if (finalScore >= 0.55 && freshnessScore !== null && freshnessScore < 50) {
    return decisionResult(isCitationIntent(intentProfile) ? "cite_as_supporting" : "use_as_background", reasons, warnings);
  }

  if (finalScore < 0.35) {
    return decisionResult(confidence === "low" ? "exclude" : "watch_only", reasons, warnings);
  }

  if (finalScore >= 0.55) {
    return decisionResult("use_as_background", reasons, warnings);
  }

  return decisionResult("watch_only", reasons, warnings);
}

export function interpretEvaluations(
  evaluations: CoreSignalEvaluationResult[],
  options: ContextDecisionOptions = {}
): ContextDecisionResult[] {
  return evaluations.map((evaluation) => interpretEvaluation(evaluation, options));
}
