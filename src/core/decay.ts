// Spec-compliant exponential DAR model.
// Higher lambda = data goes stale faster. Half-life formula: t1/2 = ln(2) / lambda.
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

export function calculateFreshnessScore(
  content_date: string | null,
  retrieved_at: string,
  adapter: string
): number | null {
  if (!content_date) return null;

  const published = new Date(content_date).getTime();
  const retrieved = new Date(retrieved_at).getTime();

  if (isNaN(published) || isNaN(retrieved)) return null;

  const hoursSinceRetrieved = Math.max(0, (retrieved - published) / (1000 * 60 * 60));
  const lambda = LAMBDA[adapter] ?? LAMBDA.default;

  return Math.max(0, Math.round(100 * Math.exp(-lambda * hoursSinceRetrieved)));
}

export function scoreLabel(score: number | null): string {
  if (score === null) return "unknown";
  if (score >= 90)   return "current";
  if (score >= 70)   return "reliable";
  if (score >= 50)   return "verify before acting";
  return "use with caution";
}
