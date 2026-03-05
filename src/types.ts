// Core data types for freshcontext-mcp

export interface FreshContext {
  content: string;
  source_url: string;
  content_date: string | null;   // When the content was originally published
  retrieved_at: string;           // When WE fetched it (always now)
  freshness_confidence: "high" | "medium" | "low";
  adapter: string;
}

export interface ExtractOptions {
  url: string;
  prompt?: string;        // What specifically to look for
  maxLength?: number;     // Truncate content to this length
  location?: string;      // Country, city, or "remote" / "worldwide"
  remoteOnly?: boolean;   // Only return remote-friendly listings
  maxAgeDays?: number;    // Filter out listings older than N days
  keywords?: string[];    // Extra keywords to highlight/filter e.g. ["FIFO", "underground"]
}

export interface AdapterResult {
  raw: string;
  content_date: string | null;
  freshness_confidence: "high" | "medium" | "low";
}
