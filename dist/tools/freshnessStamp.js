export function stampFreshness(result, options, adapter) {
    return {
        content: result.raw.slice(0, options.maxLength ?? 8000),
        source_url: options.url,
        content_date: result.content_date,
        retrieved_at: new Date().toISOString(),
        freshness_confidence: result.freshness_confidence,
        adapter,
    };
}
export function formatForLLM(ctx) {
    const dateInfo = ctx.content_date
        ? `Published: ${ctx.content_date}`
        : "Publish date: unknown";
    return [
        `[FRESHCONTEXT]`,
        `Source: ${ctx.source_url}`,
        `${dateInfo}`,
        `Retrieved: ${ctx.retrieved_at}`,
        `Confidence: ${ctx.freshness_confidence}`,
        `---`,
        ctx.content,
        `[/FRESHCONTEXT]`,
    ].join("\n");
}
