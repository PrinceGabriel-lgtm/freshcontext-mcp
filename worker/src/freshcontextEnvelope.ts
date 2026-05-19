import { calculateFreshnessScore, freshnessLabel } from "./intelligence.js";

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

export function looksLikeFailedAdapterContent(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return true;
  if (/^\[(?:error|security)\]/i.test(trimmed)) return true;
  if (/^(?:error|failed|upstream|timeout)\b/i.test(trimmed)) return true;
  const meaningful = trimmed.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!meaningful.length) return true;
  const failureLines = meaningful.filter(line =>
    /\b(?:error|failed|failure|timeout|401|403|404|429|5\d\d)\b/i.test(line)
  );
  return failureLines.length === meaningful.length;
}

export function stamp(
  content: string,
  url: string,
  date: string | null,
  confidence: "high" | "medium" | "low",
  adapter: string
): string {
  const retrieved_at = new Date().toISOString();
  const failedContent = looksLikeFailedAdapterContent(content);
  const safeDate = failedContent ? null : date;
  const safeConfidence = failedContent ? "low" : confidence;
  const freshness_score = calculateFreshnessScore(safeDate, retrieved_at, adapter);
  const sliced = content.slice(0, 6000);

  const scoreLine = freshness_score !== null
    ? `Score: ${freshness_score}/100 (${freshnessLabel(freshness_score)})`
    : `Score: unknown`;

  const textEnvelope = [
    "[FRESHCONTEXT]",
    `Source: ${url}`,
    `Published: ${safeDate ?? "unknown"}`,
    `Retrieved: ${retrieved_at}`,
    `Confidence: ${safeConfidence}`,
    scoreLine,
    "---",
    sliced,
    "[/FRESHCONTEXT]",
  ].join("\n");

  const structured = {
    freshcontext: {
      source_url:           url,
      content_date:         safeDate,
      retrieved_at,
      freshness_confidence: safeConfidence,
      freshness_score,
      adapter,
    },
    content: sliced,
  };

  const jsonBlock = [
    "[FRESHCONTEXT_JSON]",
    JSON.stringify(structured, null, 2),
    "[/FRESHCONTEXT_JSON]",
  ].join("\n");

  return `${textEnvelope}\n\n${jsonBlock}`;
}
