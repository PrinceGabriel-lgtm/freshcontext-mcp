/**
 * intelligence.ts — FreshContext Decay-Adjusted Relevancy (DAR) Engine v1.1
 *
 * Implements the core IP:
 *   R_t = R_0 · e^(-λt)
 *
 *   R_0 = Base semantic score against user profile [0–100]
 *   λ   = Source-specific decay constant (per hour)
 *   t   = Hours elapsed since content was published
 *   R_t = Final relevancy at query time
 *
 * Every signal that exits this module carries:
 *   - base_score  : semantic match quality (R_0)
 *   - rt_score    : decay-adjusted value (R_t)
 *   - ha_pri_sig  : SHA-256 audit signature (provenance)
 *   - entropy     : position on the decay curve (low / stable / high)
 *   - published_at: extracted publication date
 *
 * Author: Immanuel Gabriel (Prince Gabriel) · Grootfontein, Namibia
 */

// ─── User Profile ─────────────────────────────────────────────────────────────

export interface ScoringProfile {
  id: string;
  name: string;
  targets: string[];       // vital keywords → major boost (+15 each, up to +35)
  skills: string[];        // context keywords → minor boost (+3 each, up to +15)
  location: string;        // geographic anchor for remote-friendliness check
  exclusion_terms?: string[]; // hard kill list — score = 0 instantly
}

// ─── Decay Constants (λ per hour) ────────────────────────────────────────────
//
// These are the proprietary values that determine how fast each source's
// signal expires. Derived from empirical analysis of information half-lives
// across source types.
//
// Half-life formula: t½ = ln(2) / λ  (in hours)

const LAMBDA: Record<string, number> = {
  hackernews:     0.050,   // t½ ≈ 14h  — HN front page dies fast
  reddit:         0.010,   // t½ ≈ 3d   — community posts
  producthunt:    0.010,   // t½ ≈ 3d   — launch noise fades quickly
  jobs:           0.005,   // t½ ≈ 6d   — listings stale within a week
  finance:        0.001,   // t½ ≈ 29d  — market context
  yc:             0.001,   // t½ ≈ 29d  — company listings
  packagetrends:  0.0005,  // t½ ≈ 58d  — ecosystem activity
  github:         0.0002,  // t½ ≈ 5mo  — repos are long-lived assets
  reposearch:     0.0002,  // t½ ≈ 5mo
  google_scholar: 0.00005, // t½ ≈ 1.6y — academic work
  arxiv:          0.00005, // t½ ≈ 1.6y
  default:        0.001,   // fallback = finance/yc tier
};

// ─── Published Date Extraction ────────────────────────────────────────────────

/**
 * Extract the most recent plausible publication date from raw content.
 * Returns ISO date string (YYYY-MM-DD) or null if none found.
 */
export function extractPublishedAt(raw: string): string | null {
  // Match ISO 8601 dates from 2020 onwards (avoids ancient dates in content)
  const matches = raw.match(/\b(202[0-9]|203[0-9])-\d{2}-\d{2}/g);
  if (!matches || !matches.length) return null;

  const now = Date.now();
  const valid = matches
    .filter(d => {
      const ts = new Date(d).getTime();
      if (isNaN(ts) || ts > now) return false;
      // Reject malformed dates that JS Date silently rolls (e.g. 2024-02-30 → Mar 1)
      return new Date(ts).toISOString().slice(0, 10) === d;
    })
    .sort()
    .reverse();

  return valid[0] ?? null;
}

// ─── Base Score (R_0) ─────────────────────────────────────────────────────────

/**
 * Calculate the base semantic relevancy score R_0 [0–100].
 * Does NOT apply temporal decay — this is pure content-to-profile matching.
 */
export function calculateBaseScore(
  raw: string,
  profile: ScoringProfile,
  extraExclusions: string[] = []
): number {
  if (!raw || raw.length < 20) return 0;

  const content = raw.toLowerCase();

  // ── Tier 0: Hard exclusions ──────────────────────────────────────────────
  // Any exclusion match → score = 0, no further processing
  const allExclusions = [
    ...(profile.exclusion_terms ?? []),
    ...extraExclusions,
  ];
  if (allExclusions.some(t => content.includes(t.toLowerCase()))) {
    return 0;
  }

  // ── Baseline ─────────────────────────────────────────────────────────────
  // Start at 40 — content exists, passed exclusions, that's worth something
  let score = 40;

  // ── Tier 1: Vital keywords (profile targets) ─────────────────────────────
  // These are high-value signals: job titles, tech domains, company names
  // the user is specifically tracking. Each match = +15 pts, capped at +35.
  // Dedupe: profiles with accidental duplicate entries must not inflate score.
  const uniqueTargets = Array.from(new Set(profile.targets.map(t => t.toLowerCase())));
  const vitalMatches = uniqueTargets.filter(t => content.includes(t)).length;
  score += Math.min(35, vitalMatches * 15);

  // ── Tier 2: Context keywords (profile skills) ────────────────────────────
  // Technology skills the user has. Matches here indicate relevant content
  // even if it's not a direct target. Each match = +3 pts, capped at +15.
  const uniqueSkills = Array.from(new Set(profile.skills.map(s => s.toLowerCase())));
  const contextMatches = uniqueSkills.filter(s => content.includes(s)).length;
  score += Math.min(15, contextMatches * 3);

  // ── Geographic relevance ─────────────────────────────────────────────────
  // Remote-first check: does this content serve someone in the user's location?
  // We're not filtering hard — just boosting signals that are accessible.
  const locationLower = profile.location.toLowerCase();
  const isAccessible =
    content.includes("remote") ||
    content.includes("worldwide") ||
    content.includes("anywhere") ||
    content.includes(locationLower);
  if (isAccessible) score += 8;

  // ── Penalise errors and empty results ────────────────────────────────────
  // The < 20 length reject above is the real floor; a separate < 50 penalty
  // here was killing legitimate short signals like "OpenAI launches Atlas".
  if (
    raw.includes("[ERROR]") ||
    raw.toLowerCase().includes("not found")
  ) {
    score = Math.max(0, score - 40);
  }

  return Math.min(100, Math.max(0, Math.round(score)));
}

// ─── Decay Application (R_t) ──────────────────────────────────────────────────

export type EntropyLevel = "low" | "stable" | "high";

/**
 * Apply exponential decay to a base score.
 * Returns R_t and the entropy level (position on decay curve).
 *
 * Entropy levels:
 *   low    = t < half-life/2  → signal is still near peak value
 *   stable = t < 1.5× half-life → usable, some decay
 *   high   = t > 1.5× half-life → significantly degraded
 */
export function applyDecay(
  baseScore: number,
  publishedAt: string | null,
  adapter: string
): { rt: number; entropy: EntropyLevel } {
  if (baseScore === 0) return { rt: 0, entropy: "high" };

  const lambda = LAMBDA[adapter] ?? LAMBDA.default;
  const halfLifeHours = Math.log(2) / lambda;

  // If no publish date, conservatively assume content is 1 half-life old
  // (not the freshest, not ancient — fair middle ground)
  let t = halfLifeHours;
  if (publishedAt) {
    const published = new Date(publishedAt).getTime();
    if (!isNaN(published)) {
      t = Math.max(0, (Date.now() - published) / (1000 * 60 * 60));
    }
  }

  const rt = baseScore * Math.exp(-lambda * t);

  const entropyRatio = t / halfLifeHours;
  const entropy: EntropyLevel =
    entropyRatio < 0.5  ? "low" :
    entropyRatio < 1.5  ? "stable" : "high";

  return {
    rt: Math.round(rt * 10) / 10, // one decimal place
    entropy,
  };
}

// ─── Audit Signature ──────────────────────────────────────────────────────────

const PROVENANCE_SALT = "FRESHCONTEXT_DAR_V1";

/**
 * Generate a SHA-256 audit signature for a signal.
 * This is the ha_pri_sig — the digital fingerprint proving the signal
 * was scored by this engine at this point in time.
 *
 * Uses Web Crypto API (available natively in Cloudflare Workers).
 */
export async function generateAuditSig(
  resultId: string,
  contentHash: string
): Promise<string> {
  const input = `${resultId}:${contentHash}:${PROVENANCE_SALT}`;
  const encoded = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

// ─── Main Scoring Entry Point ─────────────────────────────────────────────────

export interface SignalScore {
  base_score: number;
  rt_score: number;
  relevancy_score: number;  // = Math.round(rt_score), kept for backwards compat
  is_relevant: 0 | 1;       // 1 if rt_score >= 35, else 0
  ha_pri_sig: string;
  entropy_level: EntropyLevel;
  published_at: string | null;
}

/**
 * Score a raw signal against a user profile.
 * This is the single entry point for the full DAR pipeline:
 *   extract date → R_0 → R_t → audit sig
 */
export async function scoreSignal(params: {
  resultId: string;
  contentHash: string;
  raw: string;
  adapter: string;
  profile: ScoringProfile;
  exclusionTerms?: string[];
}): Promise<SignalScore> {
  const published_at = extractPublishedAt(params.raw);
  const base_score = calculateBaseScore(
    params.raw,
    params.profile,
    params.exclusionTerms ?? []
  );
  const { rt, entropy } = applyDecay(base_score, published_at, params.adapter);
  const ha_pri_sig = await generateAuditSig(params.resultId, params.contentHash);
  const rt_rounded = Math.round(rt);

  return {
    base_score,
    rt_score: rt,
    relevancy_score: rt_rounded,
    is_relevant: rt_rounded >= 35 ? 1 : 0,
    ha_pri_sig,
    entropy_level: entropy,
    published_at,
  };
}

/**
 * Parse a stored profile's JSON fields into a ScoringProfile.
 * Handles the D1 storage format where arrays are stored as JSON strings.
 */
export function parseStoredProfile(row: {
  id: string;
  name: string | null;
  skills: string;
  targets: string;
  location: string | null;
}): ScoringProfile {
  const safeParse = (s: string): string[] => {
    try { return JSON.parse(s) as string[]; }
    catch { return s.split(",").map(t => t.trim()).filter(Boolean); }
  };

  return {
    id: row.id,
    name: row.name ?? "User",
    targets: safeParse(row.targets),
    skills: safeParse(row.skills),
    location: row.location ?? "remote",
  };
}

// ─── Semantic Deduplication ────────────────────────────────────────────────────

/**
 * Generate a semantic fingerprint for a piece of raw content.
 *
 * The fingerprint is built from:
 *   - The first URL-like string found in the content (canonical source)
 *   - The first publication date found
 *   - Normalised title (first non-empty line, lowercased, punctuation stripped)
 *
 * Two signals with the same fingerprint are considered duplicates regardless
 * of which adapter scraped them. This is what prevents HN + Reddit carrying
 * the same story as two separate signals into the briefing.
 *
 * Returns a short hex string (first 16 chars of SHA-256).
 */
export async function semanticFingerprint(raw: string): Promise<string> {
  // Extract first URL. Strip only known tracking params, NOT all querystrings —
  // sites that use ?id= or ?p= for legitimate identifiers must keep them.
  const urlMatch = raw.match(/https?:\/\/[^\s"'<>]{8,}/);
  let url = "";
  if (urlMatch) {
    try {
      const u = new URL(urlMatch[0]);
      const TRACKING = /^(utm_|fbclid$|gclid$|mc_|igshid$)/i;
      for (const k of Array.from(u.searchParams.keys())) {
        if (TRACKING.test(k)) u.searchParams.delete(k);
      }
      u.hash = "";
      url = (u.origin + u.pathname + (u.search || "")).toLowerCase();
    } catch {
      url = urlMatch[0].split(/[?#]/)[0].toLowerCase();
    }
  }

  // Extract first date
  const dateMatch = raw.match(/\b(202[0-9]|203[0-9])-\d{2}-\d{2}\b/);
  const date = dateMatch ? dateMatch[0] : "";

  // Normalised title: first substantial line
  const title = raw
    .split("\n")
    .map(l => l.trim())
    .filter(l => l.length > 10 && !l.startsWith("http"))[0]
    ?? "";
  const normTitle = title.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim().slice(0, 80);

  const input = `${normTitle}|${url}|${date}`;
  const encoded = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
}

/**
 * Check if a semantic fingerprint already exists in the last N days.
 * Used by the cron to skip inserting duplicate signals across adapters.
 */
export async function isDuplicate(
  db: D1Database,
  fingerprint: string,
  withinHours = 48
): Promise<boolean> {
  const result = await db.prepare(`
    SELECT COUNT(*) as n FROM scrape_results
    WHERE semantic_fingerprint = ?
      AND scraped_at >= datetime('now', '-' || ? || ' hours')
  `).bind(fingerprint, withinHours).first<{ n: number }>();
  return (result?.n ?? 0) > 0;
}
