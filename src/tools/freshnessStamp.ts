import { FreshContext, AdapterResult, ExtractOptions } from "../types.js";

// ─── Decay rates per adapter ──────────────────────────────────────────────────
// Spec-compliant exponential DAR model.
// Higher lambda = data goes stale faster. Half-life formula: t½ = ln(2) / λ.
// Lambda is measured per hour and mirrors the Worker/D1 intelligence engine.
export const LAMBDA: Record<string, number> = {
  hackernews:        0.050,
  reddit:            0.010,
  producthunt:       0.010,
  jobs:              0.005,
  finance:           0.001,
  yc:                0.001,
  packagetrends:     0.0005,
  github:            0.0002,
  reposearch:        0.0002,
  google_scholar:    0.00005,
  arxiv:             0.00005,
  changelog:         0.0005,
  gdelt:             0.020,
  gebiz:             0.003,
  govcontracts:      0.001,
  sec_filings:       0.005,
  landscape:         0.050,
  gov_landscape:     0.001,
  finance_landscape: 0.001,
  company_landscape: 0.005,
  idea_landscape:    0.050,
  default:           0.001,
};

// ─── Score calculation ────────────────────────────────────────────────────────
// Returns null when content_date is unknown — we can't calculate age without a date.
// Returns a clamped 0-100 exponential freshness score.
function calculateFreshnessScore(
  content_date: string | null,
  retrieved_at: string,
  adapter: string
): number | null {
  if (!content_date) return null;

  const published = new Date(content_date).getTime();
  const retrieved = new Date(retrieved_at).getTime();

  // Guard against unparseable dates
  if (isNaN(published) || isNaN(retrieved)) return null;

  const hoursSinceRetrieved = Math.max(0, (retrieved - published) / (1000 * 60 * 60));
  const lambda = LAMBDA[adapter] ?? LAMBDA.default;

  return Math.max(0, Math.round(100 * Math.exp(-lambda * hoursSinceRetrieved)));
}

// ─── Score label ──────────────────────────────────────────────────────────────
// Human-readable interpretation alongside the number, per the spec.
function scoreLabel(score: number | null): string {
  if (score === null) return "unknown";
  if (score >= 90)   return "current";
  if (score >= 70)   return "reliable";
  if (score >= 50)   return "verify before acting";
  return "use with caution";
}

function looksLikeFailedAdapterContent(raw: string): boolean {
  const trimmed = raw.trim();
  if (!trimmed) return true;
  if (/^\[(?:error|security)\]/i.test(trimmed)) return true;
  if (/^(?:error|failed|upstream|timeout)\b/i.test(trimmed)) return true;

  const meaningful = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!meaningful.length) return true;

  const failureLines = meaningful.filter((line) =>
    /\b(?:error|failed|failure|timeout|401|403|404|429|5\d\d)\b/i.test(line)
  );
  return failureLines.length === meaningful.length;
}

// ─── Main stamp function ──────────────────────────────────────────────────────
export function stampFreshness(
  result: AdapterResult,
  options: ExtractOptions,
  adapter: string
): FreshContext {
  const retrieved_at = new Date().toISOString();
  const failedContent = looksLikeFailedAdapterContent(result.raw);
  const content_date = failedContent ? null : result.content_date;
  const freshness_confidence = failedContent ? "low" : result.freshness_confidence;
  const freshness_score = calculateFreshnessScore(
    content_date,
    retrieved_at,
    adapter
  );

  return {
    content: result.raw.slice(0, options.maxLength ?? 8000),
    source_url: options.url,
    content_date,
    retrieved_at,
    freshness_confidence,
    freshness_score,
    adapter,
  };
}

// ─── Structured JSON form ─────────────────────────────────────────────────────
// Returns the spec-compliant JSON object defined in FRESHCONTEXT_SPEC.md.
// Programmatic consumers can parse this without touching the text envelope.
export function toStructuredJSON(ctx: FreshContext): object {
  return {
    freshcontext: {
      source_url:           ctx.source_url,
      content_date:         ctx.content_date,
      retrieved_at:         ctx.retrieved_at,
      freshness_confidence: ctx.freshness_confidence,
      freshness_score:      ctx.freshness_score,
      adapter:              ctx.adapter,
    },
    content: ctx.content,
  };
}

// ─── Text envelope formatter ──────────────────────────────────────────────────
// Produces the [FRESHCONTEXT]...[/FRESHCONTEXT] envelope defined in the spec,
// followed by a [FRESHCONTEXT_JSON]...[/FRESHCONTEXT_JSON] block so both the
// human-readable envelope and the machine-parseable JSON travel together.
export function formatForLLM(ctx: FreshContext): string {
  const dateInfo = ctx.content_date
    ? `Published: ${ctx.content_date}`
    : "Publish date: unknown";

  const scoreLine = ctx.freshness_score !== null
    ? `Score: ${ctx.freshness_score}/100 (${scoreLabel(ctx.freshness_score)})`
    : `Score: unknown`;

  const textEnvelope = [
    `[FRESHCONTEXT]`,
    `Source: ${ctx.source_url}`,
    `${dateInfo}`,
    `Retrieved: ${ctx.retrieved_at}`,
    `Confidence: ${ctx.freshness_confidence}`,
    `${scoreLine}`,
    `---`,
    ctx.content,
    `[/FRESHCONTEXT]`,
  ].join("\n");

  // Append the structured JSON block so programmatic consumers
  // can extract metadata without parsing the text envelope.
  const jsonBlock = [
    `[FRESHCONTEXT_JSON]`,
    JSON.stringify(toStructuredJSON(ctx), null, 2),
    `[/FRESHCONTEXT_JSON]`,
  ].join("\n");

  return `${textEnvelope}\n\n${jsonBlock}`;
}
