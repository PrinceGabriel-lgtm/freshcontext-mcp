import { calculateFreshnessScore } from "./decay.js";
import { explainSignal } from "./explain.js";
import { looksLikeFailedAdapterContent } from "./guards.js";
import type { FreshSignal, RankOptions, RankedSignal, SignalConfidence } from "./types.js";

const DEFAULT_SEMANTIC_WEIGHT = 0.7;
const DEFAULT_FRESHNESS_WEIGHT = 0.3;

export function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function positiveNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

function resolveWeights(options: RankOptions): { semantic: number; freshness: number } {
  let semantic = positiveNumber(options.semanticWeight);
  let freshness = positiveNumber(options.freshnessWeight);

  if (semantic === 0 && freshness === 0) {
    semantic = DEFAULT_SEMANTIC_WEIGHT;
    freshness = DEFAULT_FRESHNESS_WEIGHT;
  }

  const total = semantic + freshness;
  return {
    semantic: semantic / total,
    freshness: freshness / total,
  };
}

function resolveRetrievedAt(signal: FreshSignal, options: RankOptions): string {
  if (signal.retrieved_at) return signal.retrieved_at;
  if (options.now instanceof Date) return options.now.toISOString();
  if (typeof options.now === "string") return options.now;
  return new Date().toISOString();
}

function resolveSourceType(signal: FreshSignal, options: RankOptions): string {
  return signal.source_type ?? options.defaultSourceType ?? signal.source ?? "default";
}

function isFailedSignal(signal: FreshSignal): boolean {
  return signal.status === "failed"
    || (signal.content !== undefined && looksLikeFailedAdapterContent(signal.content));
}

function confidenceFor(signal: FreshSignal, semanticScore: number, freshnessScore: number | null): SignalConfidence {
  if (isFailedSignal(signal)) {
    return "low";
  }
  if (freshnessScore !== null && semanticScore >= 0.7) {
    return "high";
  }
  if (freshnessScore !== null || semanticScore >= 0.5) {
    return "medium";
  }
  return "low";
}

export function rankSignal(signal: FreshSignal, options: RankOptions = {}): RankedSignal {
  const weights = resolveWeights(options);
  const semantic_score = clampScore(signal.semantic_score);
  const freshness_score = isFailedSignal(signal) || signal.date_confidence === "unknown"
    ? null
    : calculateFreshnessScore(
      signal.published_at ?? signal.content_date ?? null,
      resolveRetrievedAt(signal, options),
      resolveSourceType(signal, options)
    );
  const freshnessComponent = freshness_score === null ? 0 : clampScore(freshness_score / 100);
  const final_score = clampScore(
    semantic_score * weights.semantic + freshnessComponent * weights.freshness
  );
  const confidence = confidenceFor(signal, semantic_score, freshness_score);

  const ranked: Omit<RankedSignal, "reason"> = {
    ...signal,
    semantic_score,
    freshness_score,
    final_score,
    confidence,
  };

  return {
    ...ranked,
    reason: explainSignal(ranked),
  };
}

export function rankSignals(signals: FreshSignal[], options: RankOptions = {}): RankedSignal[] {
  return signals
    .map((signal, index) => ({ ranked: rankSignal(signal, options), index }))
    .sort((a, b) => {
      const scoreDiff = b.ranked.final_score - a.ranked.final_score;
      return scoreDiff !== 0 ? scoreDiff : a.index - b.index;
    })
    .map(({ ranked }) => ranked);
}
