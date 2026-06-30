// Spec-compliant exponential DAR model.
// Higher lambda = data goes stale faster. Half-life formula: t1/2 = ln(2) / lambda.
// Lambda is measured per hour.
//
// CANONICAL SOURCE OF DECAY POLICY. This is the single definition of LAMBDA in the
// codebase. Core (pipeline, sourceProfiles, freshness scoring) and the Worker
// intelligence module (via the core/edge boundary) both derive from it — neither
// keeps its own copy. To tune a source's decay, change it here and only here. The
// single-source guard (tests/lambdaSingleSource.test.ts) goes red if a second
// `const LAMBDA` table is ever reintroduced anywhere in runtime source.
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

export const FUTURE_CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;

export function isMeaningfullyFutureDate(
  content_date: string | null,
  retrieved_at: string
): boolean {
  if (!content_date) return false;

  const published = new Date(content_date).getTime();
  const retrieved = new Date(retrieved_at).getTime();

  if (isNaN(published) || isNaN(retrieved)) return false;

  return published - retrieved > FUTURE_CLOCK_SKEW_TOLERANCE_MS;
}

export function calculateFreshnessScore(
  content_date: string | null,
  retrieved_at: string,
  adapter: string
): number | null {
  if (!content_date) return null;

  const published = new Date(content_date).getTime();
  const retrieved = new Date(retrieved_at).getTime();

  if (isNaN(published) || isNaN(retrieved)) return null;
  if (published - retrieved > FUTURE_CLOCK_SKEW_TOLERANCE_MS) return null;

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

// Brick 6 — "the eyes". The pure decay signal (freshness_score) is computed but
// was only ever emitted as a 0-100 number the consumer must interpret. These two
// functions make the staleness verdict and the revalidate-by boundary explicit.

export type StalenessVerdict = "fresh" | "aging" | "stale" | "unknown";

// Derived from the SAME score buckets as scoreLabel, not a second decay system.
// "fresh" merges scoreLabel's "current"/"reliable" (score >= 70); "aging" matches
// "verify before acting" (>= 50); "stale" matches "use with caution" (< 50). The
// 50-point line is also where computeRevalidateAfter is anchored below — crossing
// 50 is the one staleness boundary, expressed two ways (a verdict and a timestamp).
export function stalenessVerdict(score: number | null): StalenessVerdict {
  if (score === null) return "unknown";
  if (score >= 70) return "fresh";
  if (score >= 50) return "aging";
  return "stale";
}

// The timestamp at which this content's freshness_score would cross the staleness
// boundary (score = 50). Since 100 * e^(-lambda*t) = 50 solves to t = ln(2)/lambda
// — exactly one half-life — revalidate_after is always content_date + half-life.
// Uses the same null/future-date guards as calculateFreshnessScore so the two
// stay in lockstep: staleness === "unknown" if and only if revalidate_after === null.
export function computeRevalidateAfter(
  content_date: string | null,
  retrieved_at: string,
  adapter: string
): string | null {
  if (!content_date) return null;

  const published = new Date(content_date).getTime();
  const retrieved = new Date(retrieved_at).getTime();
  if (isNaN(published) || isNaN(retrieved)) return null;
  if (published - retrieved > FUTURE_CLOCK_SKEW_TOLERANCE_MS) return null;

  const lambda = LAMBDA[adapter] ?? LAMBDA.default;
  const halfLifeHours = Math.log(2) / lambda;
  return new Date(published + halfLifeHours * 60 * 60 * 1000).toISOString();
}
