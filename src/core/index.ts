export { LAMBDA, calculateFreshnessScore, scoreLabel } from "./decay.js";
export { looksLikeFailedAdapterContent } from "./guards.js";
export { stampFreshness, toStructuredJSON, formatForLLM } from "./envelope.js";
export { explainSignal } from "./explain.js";
export { rankSignals, rankSignal, clampScore } from "./rank.js";
export { calculateContextUtility } from "./utility.js";
export type {
  FreshContext,
  ExtractOptions,
  AdapterResult,
  EnvelopeFormatOptions,
  SignalConfidence,
  FreshSignal,
  RankedSignal,
  RankOptions,
  ContextUtilityStatus,
  ContextUtilityInput,
  ContextUtilityResult,
} from "./types.js";
