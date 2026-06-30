import type { FreshContext, AdapterResult, ExtractOptions, EnvelopeFormatOptions } from "./types.js";
import { calculateFreshnessScore, computeRevalidateAfter, isMeaningfullyFutureDate, scoreLabel, stalenessVerdict } from "./decay.js";
import { looksLikeFailedAdapterContent } from "./guards.js";

export const MAX_ENVELOPE_CONTENT_LENGTH = 20000;

function clampEnvelopeMaxLength(maxLength: number | undefined): number {
  if (maxLength === 0) return 0;
  if (maxLength === undefined || !Number.isFinite(maxLength)) return 8000;
  return Math.min(MAX_ENVELOPE_CONTENT_LENGTH, Math.max(1, Math.floor(maxLength)));
}

export function stampFreshness(
  result: AdapterResult,
  options: ExtractOptions,
  adapter: string
): FreshContext {
  const retrieved_at = new Date().toISOString();
  const failedContent = looksLikeFailedAdapterContent(result.raw);
  const content_date = failedContent ? null : result.content_date;
  const futureDated = !failedContent && isMeaningfullyFutureDate(content_date, retrieved_at);
  const freshness_confidence = failedContent || futureDated ? "low" : result.freshness_confidence;
  const freshness_score = calculateFreshnessScore(
    content_date,
    retrieved_at,
    adapter
  );
  const staleness = stalenessVerdict(freshness_score);
  const revalidate_after = computeRevalidateAfter(content_date, retrieved_at, adapter);

  return {
    content: result.raw.slice(0, clampEnvelopeMaxLength(options.maxLength)),
    source_url: options.url,
    content_date,
    retrieved_at,
    freshness_confidence,
    freshness_score,
    adapter,
    staleness,
    revalidate_after,
  };
}

export function toStructuredJSON(ctx: FreshContext): object {
  return {
    freshcontext: {
      source_url:           ctx.source_url,
      content_date:         ctx.content_date,
      retrieved_at:         ctx.retrieved_at,
      freshness_confidence: ctx.freshness_confidence,
      freshness_score:      ctx.freshness_score,
      adapter:              ctx.adapter,
      staleness:            ctx.staleness,
      revalidate_after:     ctx.revalidate_after,
    },
    content: ctx.content,
  };
}

export function formatForLLM(ctx: FreshContext, options: EnvelopeFormatOptions = {}): string {
  const publishedLabel = options.publishedLabel ?? "Published";
  const unknownDateText = options.unknownDateText ?? "Publish date: unknown";
  const dateInfo = ctx.content_date
    ? `${publishedLabel}: ${ctx.content_date}`
    : unknownDateText;

  const scoreLine = ctx.freshness_score !== null
    ? `Score: ${ctx.freshness_score}/100 (${scoreLabel(ctx.freshness_score)})`
    : `Score: unknown`;

  const stalenessLine = ctx.revalidate_after !== null
    ? `Staleness: ${ctx.staleness} (revalidate by ${ctx.revalidate_after})`
    : `Staleness: ${ctx.staleness}`;

  const textEnvelope = [
    `[FRESHCONTEXT]`,
    `Source: ${ctx.source_url}`,
    `${dateInfo}`,
    `Retrieved: ${ctx.retrieved_at}`,
    `Confidence: ${ctx.freshness_confidence}`,
    `${scoreLine}`,
    `${stalenessLine}`,
    `---`,
    ctx.content,
    `[/FRESHCONTEXT]`,
  ].join("\n");

  const jsonBlock = [
    `[FRESHCONTEXT_JSON]`,
    JSON.stringify(toStructuredJSON(ctx), null, 2),
    `[/FRESHCONTEXT_JSON]`,
  ].join("\n");

  return `${textEnvelope}\n\n${jsonBlock}`;
}
