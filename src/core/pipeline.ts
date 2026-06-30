import { LAMBDA, calculateFreshnessScore, computeRevalidateAfter, stalenessVerdict } from "./decay.js";
import { formatForLLM, toStructuredJSON } from "./envelope.js";
import { calculateHaPriV2 } from "./provenance.js";
import { prepareProvenanceReadiness } from "./provenanceReadiness.js";
import { rankSignal } from "./rank.js";
import { normalizeSignal } from "./signal.js";
import { calculateContextUtility } from "./utility.js";
import type {
  CoreSignalEvaluationOptions,
  CoreSignalEvaluationResult,
  CoreSignalEnvelopeResult,
  FreshContext,
  FreshContextSignal,
  FreshContextSignalInput,
  HaPriV2Result,
  SignalConfidence,
} from "./types.js";

function ageHours(signal: FreshContextSignal): number {
  if (!signal.published_at) return 0;
  const published = new Date(signal.published_at).getTime();
  const retrieved = new Date(signal.retrieved_at).getTime();
  if (isNaN(published) || isNaN(retrieved)) return 0;
  return Math.max(0, (retrieved - published) / (1000 * 60 * 60));
}

function envelopeConfidence(signal: FreshContextSignal): SignalConfidence {
  if (signal.status === "failed" || signal.date_confidence === "unknown") return "low";
  return signal.date_confidence;
}

function createEnvelope(
  signal: FreshContextSignal,
  freshnessScore: number | null,
  options: CoreSignalEvaluationOptions
): CoreSignalEnvelopeResult | undefined {
  if (!options.includeEnvelope || signal.content === undefined) return undefined;

  // Mirrors the same failed/unknown override applied to freshnessScore at the
  // call site, so staleness === "unknown" iff revalidate_after === null holds
  // here too (computeRevalidateAfter's own date guard alone wouldn't catch a
  // failed-status signal that still carries a parseable published_at).
  const revalidate_after = signal.status === "failed" || signal.date_confidence === "unknown"
    ? null
    : computeRevalidateAfter(signal.published_at, signal.retrieved_at, signal.source_type);

  const ctx: FreshContext = {
    content: signal.content.slice(0, options.envelopeMaxLength ?? 8000),
    source_url: signal.source,
    content_date: signal.published_at,
    retrieved_at: signal.retrieved_at,
    freshness_confidence: envelopeConfidence(signal),
    freshness_score: freshnessScore,
    adapter: signal.source_type,
    staleness: stalenessVerdict(freshnessScore),
    revalidate_after,
  };

  return {
    context: ctx,
    text: formatForLLM(ctx, options.envelopeFormat),
    structured: toStructuredJSON(ctx),
  };
}

function createProvenance(
  signal: FreshContextSignal,
  options: CoreSignalEvaluationOptions,
  reasons: string[]
): HaPriV2Result | undefined {
  if (!options.includeProvenance) return undefined;

  const resultId = options.provenance?.resultId ?? signal.id;
  const engineVersion = options.provenance?.engineVersion;
  if (!signal.content) {
    reasons.push("provenance was requested but content was missing");
    return undefined;
  }
  if (!resultId) {
    reasons.push("provenance was requested but resultId was missing");
    return undefined;
  }
  if (!engineVersion) {
    reasons.push("provenance was requested but engineVersion was missing");
    return undefined;
  }

  return calculateHaPriV2({
    resultId,
    rawContent: signal.content,
    semanticFingerprint: options.provenance?.semanticFingerprint ?? null,
    adapter: signal.source_type,
    publishedAt: signal.published_at,
    retrievedAt: signal.retrieved_at,
    engineVersion,
  });
}

export function evaluateSignal(
  input: FreshContextSignalInput,
  options: CoreSignalEvaluationOptions = {}
): CoreSignalEvaluationResult {
  const signal = normalizeSignal(input, options);
  const freshness_score = signal.status === "failed" || signal.date_confidence === "unknown"
    ? null
    : calculateFreshnessScore(signal.published_at, signal.retrieved_at, signal.source_type);
  const utility = calculateContextUtility({
    contextualRelevance: signal.semantic_score * 100,
    lambda: LAMBDA[signal.source_type] ?? LAMBDA.default,
    ageHours: ageHours(signal),
    dateConfidence: signal.date_confidence,
    status: signal.status,
  });
  const ranked = rankSignal(signal, options);
  const reasons = [...signal.reasons, ...utility.reasons];
  const envelope = createEnvelope(signal, freshness_score, options);
  const provenance = createProvenance(signal, options, reasons);
  const provenance_readiness = prepareProvenanceReadiness(signal, {
    now: options.now,
    resultId: options.provenance?.resultId ?? signal.id,
    semanticFingerprint: options.provenance?.semanticFingerprint ?? null,
    engineVersion: options.provenance?.engineVersion,
  });

  return {
    signal,
    freshness_score,
    utility,
    ranked,
    explanation: ranked.reason,
    envelope,
    provenance,
    provenance_readiness,
    reasons,
  };
}

export function evaluateSignals(
  inputs: FreshContextSignalInput[],
  options: CoreSignalEvaluationOptions = {}
): CoreSignalEvaluationResult[] {
  return inputs
    .map((input, index) => ({ evaluation: evaluateSignal(input, options), index }))
    .sort((a, b) => {
      const scoreDiff = b.evaluation.ranked.final_score - a.evaluation.ranked.final_score;
      return scoreDiff !== 0 ? scoreDiff : a.index - b.index;
    })
    .map(({ evaluation }) => evaluation);
}
