import { calculateHaPriV2, canonicalizeHaPriContent, sha256Hex } from "./provenance.js";
import { SIGNAL_CONTRACT_VERSION, normalizeSignal } from "./signal.js";
import type {
  FreshContextSignal,
  FreshContextSignalInput,
  HaPriV2Result,
  ProvenanceReadinessInput,
  ProvenanceReadinessOptions,
  ProvenanceReadinessResult,
  ProvenanceReadinessState,
  ProvenanceSourceIdentityCompleteness,
  ProvenanceTimingCompleteness,
} from "./types.js";

const UNUSABLE_SOURCE_VALUES = new Set([
  "unknown",
  "n/a",
  "na",
  "none",
  "null",
  "undefined",
  "not provided",
  "tbd",
]);

const WEAK_SOURCE_TYPES = new Set(["", "default", "unknown", "custom"]);
const DERIVED_SOURCE_TYPES = new Set([
  "copy",
  "copied",
  "derived",
  "excerpt",
  "local",
  "local_custom",
  "local_file",
  "local_handoff",
  "secondary",
  "summary",
]);

function cleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function isNormalizedSignal(input: ProvenanceReadinessInput): input is FreshContextSignal {
  return (input as FreshContextSignal).contract_version === SIGNAL_CONTRACT_VERSION;
}

function coerceInput(input: ProvenanceReadinessInput): FreshContextSignalInput {
  const value = input as Partial<FreshContextSignalInput>;
  return {
    ...value,
    source: cleanString(value.source) ?? "",
  } as FreshContextSignalInput;
}

function metadataString(signal: FreshContextSignal, keys: string[]): string | null {
  for (const key of keys) {
    const value = signal.metadata[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

function metadataBoolean(signal: FreshContextSignal, keys: string[]): boolean {
  return keys.some((key) => signal.metadata[key] === true);
}

function hasStringField(input: ProvenanceReadinessInput, field: keyof FreshContextSignalInput): boolean {
  return cleanString((input as Partial<FreshContextSignalInput>)[field]) !== null;
}

function sourceIdentityCompleteness(source: string | null): ProvenanceSourceIdentityCompleteness {
  if (!source) return "missing";
  const lower = source.toLowerCase();
  if (UNUSABLE_SOURCE_VALUES.has(lower)) return "unusable";
  if (source.length < 4) return "weak";
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(source)) return "complete";
  if (/^[a-z][a-z0-9+.-]*:/i.test(source)) return "complete";
  if (/^[a-z]:\\/i.test(source) || source.startsWith("/") || source.startsWith("\\\\")) return "complete";
  if (source.includes("/") || source.includes("\\") || source.includes(".")) return "complete";
  return source.length >= 12 ? "complete" : "weak";
}

function isDerivedContext(signal: FreshContextSignal): boolean {
  const sourceType = signal.source_type.toLowerCase();
  if (DERIVED_SOURCE_TYPES.has(sourceType)) return true;
  if (metadataBoolean(signal, ["is_derived", "derived", "copied", "is_secondary"])) return true;
  return metadataString(signal, [
    "derived_from",
    "copied_from",
    "original_source",
    "origin_source",
    "source_chain",
  ]) !== null;
}

function timingCompleteness(
  signal: FreshContextSignal,
  retrievedAtWasProvided: boolean | null
): ProvenanceTimingCompleteness {
  if (signal.status === "failed") return "unknown";
  if (!signal.published_at && !signal.retrieved_at) return "missing";
  if (!signal.published_at || signal.date_confidence === "unknown" || retrievedAtWasProvided === false) {
    return "partial";
  }
  return "complete";
}

function readinessState(input: {
  signal: FreshContextSignal;
  sourceCompleteness: ProvenanceSourceIdentityCompleteness;
  timingCompleteness: ProvenanceTimingCompleteness;
  sourceTypeWeak: boolean;
  hasCanonicalHash: boolean;
  derived: boolean;
}): ProvenanceReadinessState {
  if (input.signal.status === "failed" || input.sourceCompleteness === "unusable") return "unknown";
  if (input.derived) return "derived";
  if (input.sourceCompleteness === "missing" || !input.hasCanonicalHash) return "incomplete";
  if (
    input.sourceCompleteness === "complete"
    && input.timingCompleteness === "complete"
    && !input.sourceTypeWeak
  ) {
    return "complete";
  }
  return "partial";
}

function canonicalContentHash(signal: FreshContextSignal): string | null {
  return signal.content === undefined ? null : sha256Hex(canonicalizeHaPriContent(signal.content));
}

function prepareHaPriV2(input: {
  signal: FreshContextSignal;
  resultId: string | null;
  semanticFingerprint: string | null;
  engineVersion: string | null;
  reasons: string[];
}): HaPriV2Result | null {
  if (input.signal.status === "failed") {
    input.reasons.push("Ha-Pri v2 identity material was not prepared for failed context");
    return null;
  }
  if (!input.signal.content) {
    input.reasons.push("Ha-Pri v2 identity material needs content");
    return null;
  }
  if (!input.resultId) {
    input.reasons.push("Ha-Pri v2 identity material needs a result id or stable source identity");
    return null;
  }
  if (!input.engineVersion) {
    input.reasons.push("Ha-Pri v2 identity material needs an explicit engine version");
    return null;
  }

  input.reasons.push("Ha-Pri v2 identity material prepared from caller-provided context");
  return calculateHaPriV2({
    resultId: input.resultId,
    rawContent: input.signal.content,
    semanticFingerprint: input.semanticFingerprint,
    adapter: input.signal.source_type,
    publishedAt: input.signal.published_at,
    retrievedAt: input.signal.retrieved_at,
    engineVersion: input.engineVersion,
  });
}

export function prepareProvenanceReadiness(
  input: ProvenanceReadinessInput,
  options: ProvenanceReadinessOptions = {}
): ProvenanceReadinessResult {
  const normalizedInput = isNormalizedSignal(input);
  const signal = normalizedInput ? input : normalizeSignal(coerceInput(input), options);
  const warnings: string[] = [];
  const reasons: string[] = [...signal.reasons];

  const source = cleanString(signal.source);
  const sourceCompleteness = sourceIdentityCompleteness(source);
  const sourceType = cleanString(signal.source_type);
  const sourceTypeWeak = !sourceType || WEAK_SOURCE_TYPES.has(sourceType.toLowerCase());
  const retrievedAtWasProvided = normalizedInput ? null : hasStringField(input, "retrieved_at");
  const timeCompleteness = timingCompleteness(signal, retrievedAtWasProvided);
  const canonicalHash = canonicalContentHash(signal);
  const semanticFingerprint = cleanString(options.semanticFingerprint)
    ?? metadataString(signal, ["semantic_fingerprint", "semanticFingerprint"]);
  const semanticFingerprintHash = semanticFingerprint ? sha256Hex(semanticFingerprint) : null;
  const resultId = cleanString(options.resultId)
    ?? cleanString(signal.id)
    ?? metadataString(signal, ["result_id", "resultId", "source_id", "sourceId"])
    ?? (sourceCompleteness === "complete" ? source : null);
  const engineVersion = cleanString(options.engineVersion);
  const derived = isDerivedContext(signal);

  if (sourceCompleteness === "missing") warnings.push("source identity is missing");
  if (sourceCompleteness === "weak") warnings.push("source identity is weak");
  if (sourceCompleteness === "unusable") warnings.push("source identity is unusable");
  if (sourceTypeWeak) warnings.push("source_type is missing or generic");
  if (!signal.published_at) warnings.push("published_at is missing or unusable");
  if (retrievedAtWasProvided === false) warnings.push("retrieved_at was missing; normalization time was used");
  if (signal.date_confidence === "unknown") warnings.push("timing confidence is unknown");
  if (!canonicalHash) warnings.push("content is missing; canonical content hash is unavailable");
  if (!semanticFingerprintHash) reasons.push("semantic fingerprint was not provided");
  if (derived) warnings.push("context appears copied, local, secondary, or derived; preserve the upstream source chain");
  if (signal.status === "failed") warnings.push("failed context has unknown provenance readiness");

  const haPriV2 = prepareHaPriV2({
    signal,
    resultId,
    semanticFingerprint,
    engineVersion,
    reasons,
  });
  const state = readinessState({
    signal,
    sourceCompleteness,
    timingCompleteness: timeCompleteness,
    sourceTypeWeak,
    hasCanonicalHash: canonicalHash !== null,
    derived,
  });

  return {
    state,
    source_identity: {
      source,
      source_type: sourceType,
      result_id: resultId,
      completeness: sourceCompleteness,
    },
    source_type: sourceType,
    published_at: signal.published_at,
    retrieved_at: signal.retrieved_at,
    timing_confidence: signal.date_confidence,
    timing_completeness: timeCompleteness,
    canonical_content_sha256: canonicalHash,
    semantic_fingerprint_sha256: semanticFingerprintHash,
    ha_pri_v2: haPriV2,
    warnings: unique(warnings),
    reasons: unique(reasons),
  };
}
