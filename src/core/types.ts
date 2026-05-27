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
