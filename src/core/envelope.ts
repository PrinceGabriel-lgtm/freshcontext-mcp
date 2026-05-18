import { FreshContext, AdapterResult, ExtractOptions } from "../types.js";
import { calculateFreshnessScore, scoreLabel } from "./decay.js";
import { looksLikeFailedAdapterContent } from "./guards.js";

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

  const jsonBlock = [
    `[FRESHCONTEXT_JSON]`,
    JSON.stringify(toStructuredJSON(ctx), null, 2),
    `[/FRESHCONTEXT_JSON]`,
  ].join("\n");

  return `${textEnvelope}\n\n${jsonBlock}`;
}
