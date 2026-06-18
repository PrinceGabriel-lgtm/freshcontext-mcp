export interface FreshContext {
  content: string;
  source_url: string;
  content_date: string | null;
  retrieved_at: string;
  freshness_confidence: "high" | "medium" | "low";
  freshness_score: number | null;
  adapter: string;
}

export interface ExtractOptions {
  url: string;
  prompt?: string;
  maxLength?: number;
  location?: string;
  remoteOnly?: boolean;
  maxAgeDays?: number;
  keywords?: string[];
}

export interface AdapterResult {
  raw: string;
  content_date: string | null;
  freshness_confidence: "high" | "medium" | "low";
}

export interface EnvelopeFormatOptions {
  unknownDateText?: string;
  publishedLabel?: string;
}

export type SignalConfidence = "high" | "medium" | "low";
export type SignalDateConfidence = SignalConfidence | "unknown";
export type SignalContractVersion = "freshcontext.signal.v1";
export type SourceAuthorityHint = "high" | "medium" | "low";
export type SourceDatePolicy = "strict" | "balanced" | "lenient";
export type SourceFailurePolicy = "exclude" | "downgrade" | "warn";
export type SourceSurface = "mcp" | "rest" | "sdk" | "cli" | "operator";
export type SourceProfileId =
  | "official_docs"
  | "code_activity"
  | "social_pulse"
  | "academic_research"
  | "market_finance"
  | "jobs_opportunities"
  | "government_regulatory"
  | "company_intel"
  | "product_research"
  | "composite_landscape"
  | "multi_agent_handoff"
  | "local_custom";

export type ContextDecision =
  | "use_first"
  | "cite_as_primary"
  | "cite_as_supporting"
  | "use_as_background"
  | "needs_verification"
  | "needs_refresh"
  | "watch_only"
  | "exclude";

export type IntentProfileId =
  | "citation_check"
  | "student_research"
  | "developer_adoption"
  | "job_search"
  | "market_watch"
  | "business_due_diligence"
  | "medical_literature_triage";

export type ContextUtilityStatus =
  | "success"
  | "partial"
  | "stale"
  | "failed"
  | "unknown";

export interface SignalNormalizeOptions {
  defaultSourceType?: string;
  now?: Date | string;
}

export interface SourceProfile {
  profile_id: SourceProfileId;
  source_types: string[];
  purpose: string;
  default_decay_lambda: number;
  half_life_hours: number;
  authority_hint: SourceAuthorityHint;
  date_policy: SourceDatePolicy;
  failure_policy: SourceFailurePolicy;
  recommended_surfaces: SourceSurface[];
}

export interface ContextDecisionOptions {
  sourceProfile?: SourceProfile | SourceProfileId;
  intentProfile?: IntentProfileId;
}

export interface ContextDecisionResult {
  decision: ContextDecision;
  /**
   * Deterministic fingerprint of this verdict (signal identity + decision +
   * profile selection). Stable across repeated evaluations of the same
   * input; intentionally NOT derived from utility or provenance_readiness.
   * This is the id a future verification event would reference when
   * resolving a needs_verification (or similar) decision.
   */
  verdict_id?: string;
  label: string;
  meaning: string;
  action: string;
  reasons: string[];
  warnings: string[];
}

export interface HumanReadableHandoffResult {
  safe_for_agent_handoff: boolean;
  reason: string;
}

export interface HumanReadableContextResult {
  label: string;
  summary: string;
  why: string[];
  action: string;
  warnings: string[];
  handoff: HumanReadableHandoffResult;
}

export interface FreshContextSignalInput {
  id?: string;
  source: string;
  source_type?: string;
  title?: string;
  content?: string;
  published_at?: string | null;
  content_date?: string | null;
  retrieved_at?: string | null;
  semantic_score?: number;
  date_confidence?: SignalDateConfidence;
  freshness_confidence?: SignalConfidence;
  status?: ContextUtilityStatus;
  metadata?: Record<string, unknown>;
}

export interface FreshContextSignal {
  contract_version: SignalContractVersion;
  id?: string;
  source: string;
  source_type: string;
  title?: string;
  content?: string;
  published_at: string | null;
  retrieved_at: string;
  semantic_score: number;
  date_confidence: SignalDateConfidence;
  status: ContextUtilityStatus;
  metadata: Record<string, unknown>;
  reasons: string[];
}

export interface FreshSignal {
  id?: string;
  source: string;
  source_type?: string;
  title?: string;
  content?: string;
  published_at?: string | null;
  content_date?: string | null;
  retrieved_at?: string | null;
  semantic_score: number;
  date_confidence?: SignalDateConfidence;
  freshness_confidence?: SignalConfidence;
  status?: ContextUtilityStatus;
  metadata?: Record<string, unknown>;
}

export interface RankedSignal extends FreshSignal {
  freshness_score: number | null;
  final_score: number;
  confidence: SignalConfidence;
  reason: string;
}

export interface RankOptions {
  semanticWeight?: number;
  freshnessWeight?: number;
  defaultSourceType?: string;
  now?: Date | string;
}

export interface ContextUtilityInput {
  contextualRelevance: number;
  lambda: number;
  ageHours: number;
  dateConfidence?: SignalConfidence | "unknown";
  status?: ContextUtilityStatus;
}

export interface ContextUtilityResult {
  score: number;
  contextualRelevance: number;
  decayFactor: number;
  dateConfidenceFactor: number;
  statusFactor: number;
  lambda: number;
  ageHours: number;
  status: ContextUtilityStatus;
  reasons: string[];
}

export interface HaPriV2Input {
  resultId: string;
  rawContent: string;
  semanticFingerprint?: string | null;
  adapter: string;
  publishedAt?: string | null;
  retrievedAt?: string | null;
  engineVersion: string;
}

export interface HaPriV2Material {
  version: "FRESHCONTEXT_HA_PRI_V2";
  resultId: string;
  canonicalContentSha256: string;
  semanticFingerprintSha256: string;
  adapter: string;
  publishedAt: string;
  retrievedAt: string;
  engineVersion: string;
  signingPayload: string;
}

export interface HaPriV2Result extends HaPriV2Material {
  haPriSigV2: string;
}

export type HaPriVerificationStatus = "valid" | "invalid" | "unknown";

export interface HaPriV2VerificationResult {
  status: HaPriVerificationStatus;
  expected: string | null;
  actual: string | null;
  reasons: string[];
}

export type ProvenanceReadinessState = "complete" | "partial" | "incomplete" | "unknown" | "derived";
export type ProvenanceSourceIdentityCompleteness = "complete" | "weak" | "missing" | "unusable";
export type ProvenanceTimingCompleteness = "complete" | "partial" | "missing" | "unknown";
export type ProvenanceReadinessInput = Partial<FreshContextSignalInput> | FreshContextSignal;

export interface ProvenanceReadinessOptions extends SignalNormalizeOptions {
  resultId?: string;
  semanticFingerprint?: string | null;
  engineVersion?: string;
}

export interface ProvenanceSourceIdentityResult {
  source: string | null;
  source_type: string | null;
  result_id: string | null;
  completeness: ProvenanceSourceIdentityCompleteness;
}

export interface ProvenanceReadinessResult {
  state: ProvenanceReadinessState;
  source_identity: ProvenanceSourceIdentityResult;
  source_type: string | null;
  published_at: string | null;
  retrieved_at: string | null;
  timing_confidence: SignalDateConfidence;
  timing_completeness: ProvenanceTimingCompleteness;
  canonical_content_sha256: string | null;
  semantic_fingerprint_sha256: string | null;
  ha_pri_v2: HaPriV2Result | null;
  warnings: string[];
  reasons: string[];
}

export interface CoreSignalProvenanceOptions {
  resultId?: string;
  semanticFingerprint?: string | null;
  engineVersion?: string;
}

export interface CoreSignalEnvelopeResult {
  context: FreshContext;
  text: string;
  structured: object;
}

export interface CoreSignalEvaluationOptions extends SignalNormalizeOptions, RankOptions {
  includeEnvelope?: boolean;
  envelopeMaxLength?: number;
  envelopeFormat?: EnvelopeFormatOptions;
  includeProvenance?: boolean;
  provenance?: CoreSignalProvenanceOptions;
}

export interface CoreSignalEvaluationResult {
  signal: FreshContextSignal;
  freshness_score: number | null;
  utility: ContextUtilityResult;
  ranked: RankedSignal;
  explanation: string;
  envelope?: CoreSignalEnvelopeResult;
  provenance?: HaPriV2Result;
  provenance_readiness: ProvenanceReadinessResult;
  reasons: string[];
}
