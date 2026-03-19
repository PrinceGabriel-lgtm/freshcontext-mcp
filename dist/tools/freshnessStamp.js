// ─── Decay rates per adapter ──────────────────────────────────────────────────
// From FreshContext Specification v1.0.
// Higher decay = data goes stale faster. Half-life = 100 / (2 * decayRate) days.
// finance=5.0 (half-life ~10d), jobs=3.0 (~17d), news/hn=2.0 (~25d),
// github=1.0 (~50d), scholar/arxiv=0.3 (~167d), default=1.5 (~33d)
const DECAY_RATES = {
    finance: 5.0,
    search_jobs: 3.0,
    hackernews: 2.0,
    reddit: 2.0,
    producthunt: 2.0,
    yc: 1.5,
    govcontracts: 1.5,
    github: 1.0,
    repoSearch: 1.0,
    packageTrends: 1.0,
    changelog: 1.0,
    scholar: 0.3,
    arxiv: 0.3,
};
// ─── Score calculation ────────────────────────────────────────────────────────
// Returns null when content_date is unknown — we can't calculate age without a date.
// Returns 0 when the score would go negative (content is very old).
function calculateFreshnessScore(content_date, retrieved_at, adapter) {
    if (!content_date)
        return null;
    const published = new Date(content_date).getTime();
    const retrieved = new Date(retrieved_at).getTime();
    // Guard against unparseable dates
    if (isNaN(published) || isNaN(retrieved))
        return null;
    const daysSinceRetrieved = (retrieved - published) / (1000 * 60 * 60 * 24);
    const decayRate = DECAY_RATES[adapter] ?? 1.5;
    return Math.max(0, Math.round(100 - daysSinceRetrieved * decayRate));
}
// ─── Score label ──────────────────────────────────────────────────────────────
// Human-readable interpretation alongside the number, per the spec.
function scoreLabel(score) {
    if (score === null)
        return "unknown";
    if (score >= 90)
        return "current";
    if (score >= 70)
        return "reliable";
    if (score >= 50)
        return "verify before acting";
    return "use with caution";
}
// ─── Main stamp function ──────────────────────────────────────────────────────
export function stampFreshness(result, options, adapter) {
    const retrieved_at = new Date().toISOString();
    const freshness_score = calculateFreshnessScore(result.content_date, retrieved_at, adapter);
    return {
        content: result.raw.slice(0, options.maxLength ?? 8000),
        source_url: options.url,
        content_date: result.content_date,
        retrieved_at,
        freshness_confidence: result.freshness_confidence,
        freshness_score,
        adapter,
    };
}
// ─── Text envelope formatter ──────────────────────────────────────────────────
// Produces the [FRESHCONTEXT]...[/FRESHCONTEXT] envelope defined in the spec.
// The freshness_score line is only included when a score could be calculated.
export function formatForLLM(ctx) {
    const dateInfo = ctx.content_date
        ? `Published: ${ctx.content_date}`
        : "Publish date: unknown";
    const scoreLine = ctx.freshness_score !== null
        ? `Score: ${ctx.freshness_score}/100 (${scoreLabel(ctx.freshness_score)})`
        : `Score: unknown`;
    return [
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
}
