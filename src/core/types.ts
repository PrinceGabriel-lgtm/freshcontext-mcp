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

export interface FreshSignal {
  id?: string;
  source: string;
  source_type?: string;
  title?: string;
  content?: string;
  published_at?: string | null;
  retrieved_at?: string | null;
  semantic_score: number;
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

export type ContextUtilityStatus =
  | "success"
  | "partial"
  | "stale"
  | "failed"
  | "unknown";

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
