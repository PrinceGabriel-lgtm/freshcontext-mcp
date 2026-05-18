import type { SignalConfidence } from "./types.js";

interface ExplainSignalInput {
  source?: string;
  source_type?: string;
  semantic_score: number;
  freshness_score: number | null;
  final_score: number;
  confidence: SignalConfidence;
  published_at?: string | null;
}

function sourceLabel(input: ExplainSignalInput): string {
  return input.source_type || input.source || "source";
}

export function explainSignal(input: ExplainSignalInput): string {
  const source = sourceLabel(input);

  if (input.freshness_score === null) {
    if (input.semantic_score < 0.5) {
      return `Low confidence: weak semantic match and missing freshness data for ${source}.`;
    }
    return `Missing freshness data for ${source}; ranked mostly by semantic relevance.`;
  }

  if (input.semantic_score < 0.5) {
    if (input.freshness_score >= 70) {
      return `Fresh signal from ${source}, but semantic relevance is weak.`;
    }
    return `Weak semantic match with limited freshness for ${source}.`;
  }

  if (input.freshness_score >= 90) {
    return `Strong semantic match and current freshness for ${source}.`;
  }
  if (input.freshness_score >= 70) {
    return `Relevant signal with reliable freshness for ${source}.`;
  }
  if (input.freshness_score >= 50) {
    return `Relevant signal, but freshness should be verified for ${source}.`;
  }
  return `Relevant signal, but stale for ${source}.`;
}
