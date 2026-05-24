export { LAMBDA, calculateFreshnessScore, scoreLabel } from "./decay.js";
export { looksLikeFailedAdapterContent } from "./guards.js";
export { stampFreshness, toStructuredJSON, formatForLLM } from "./envelope.js";
export { explainSignal } from "./explain.js";
export { rankSignals, rankSignal, clampScore } from "./rank.js";
export { calculateContextUtility } from "./utility.js";
export {
  canonicalizeHaPriContent,
  sha256Hex,
  calculateHaPriV2,
  verifyHaPriV2,
} from "./provenance.js";
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
  HaPriV2Input,
  HaPriV2Material,
  HaPriV2Result,
  HaPriVerificationStatus,
  HaPriV2VerificationResult,
} from "./types.js";
