export { LAMBDA, calculateFreshnessScore, scoreLabel } from "./decay.js";
export { looksLikeFailedAdapterContent } from "./guards.js";
export { stampFreshness, toStructuredJSON, formatForLLM } from "./envelope.js";
export { explainSignal } from "./explain.js";
export { rankSignals, rankSignal, clampScore } from "./rank.js";
export type {
  FreshContext,
  ExtractOptions,
  AdapterResult,
  SignalConfidence,
  FreshSignal,
  RankedSignal,
  RankOptions,
} from "./types.js";
