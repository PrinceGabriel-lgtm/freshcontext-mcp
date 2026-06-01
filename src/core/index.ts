export { LAMBDA, calculateFreshnessScore, scoreLabel } from "./decay.js";
export { looksLikeFailedAdapterContent } from "./guards.js";
export { stampFreshness, toStructuredJSON, formatForLLM } from "./envelope.js";
export { explainSignal } from "./explain.js";
export { rankSignals, rankSignal, clampScore } from "./rank.js";
export { calculateContextUtility } from "./utility.js";
export { SIGNAL_CONTRACT_VERSION, normalizeSignal } from "./signal.js";
export { evaluateSignal, evaluateSignals } from "./pipeline.js";
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
  SignalDateConfidence,
  SignalContractVersion,
  SignalNormalizeOptions,
  FreshContextSignalInput,
  FreshContextSignal,
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
  CoreSignalProvenanceOptions,
  CoreSignalEnvelopeResult,
  CoreSignalEvaluationOptions,
  CoreSignalEvaluationResult,
} from "./types.js";
