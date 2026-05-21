import {
  formatForLLM,
  looksLikeFailedAdapterContent,
  stampFreshness,
} from "../../src/core/index.js";

export { looksLikeFailedAdapterContent };

export function parseFreshContextJson(text: string): Record<string, any> | null {
  const match = text.match(/\[FRESHCONTEXT_JSON\]\s*([\s\S]*?)\s*\[\/FRESHCONTEXT_JSON\]/);
  if (!match) return null;
  try { return JSON.parse(match[1]) as Record<string, any>; } catch { return null; }
}

export function replaceFreshContextJson(text: string, structured: Record<string, any>): string {
  const block = [
    "[FRESHCONTEXT_JSON]",
    JSON.stringify(structured, null, 2),
    "[/FRESHCONTEXT_JSON]",
  ].join("\n");
  return text.replace(/\[FRESHCONTEXT_JSON\]\s*[\s\S]*?\s*\[\/FRESHCONTEXT_JSON\]/, block);
}

export function isUncacheableContent(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (/^\[ERROR\]/i.test(trimmed)) return true;
  return false;
}

export function analyzeCompositeContent(content: string): { allUnavailable: boolean; hasPartialFailures: boolean } {
  const lines = content.split(/\r?\n/);
  let inSection = false;
  let hasUsefulContent = false;
  let hasUnavailableContent = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("## ")) { inSection = true; continue; }
    if (!inSection || !trimmed) continue;
    if (trimmed.startsWith("[Unavailable:") || trimmed === "Error") {
      hasUnavailableContent = true;
    } else {
      hasUsefulContent = true;
    }
  }
  return {
    allUnavailable: inSection && !hasUsefulContent,
    hasPartialFailures: inSection && hasUnavailableContent,
  };
}

export function stamp(
  content: string,
  url: string,
  date: string | null,
  confidence: "high" | "medium" | "low",
  adapter: string
): string {
  const ctx = stampFreshness(
    {
      raw: content,
      content_date: date,
      freshness_confidence: confidence,
    },
    { url, maxLength: 6000 },
    adapter
  );

  return formatForLLM(ctx, { unknownDateText: "Published: unknown" });
}
