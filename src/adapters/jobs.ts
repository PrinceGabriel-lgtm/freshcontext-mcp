import { AdapterResult, ExtractOptions } from "../types.js";

/**
 * Jobs adapter v3 — 5 sources, freshness badges, location + keyword filtering.
 *
 * Sources (all no-auth):
 *   - Remotive       — remote tech jobs, salary data
 *   - RemoteOK       — pure remote, unix timestamps
 *   - Arbeitnow      — broad jobs API (tech + non-tech, location-aware)
 *   - The Muse       — structured listings, level info
 *   - HN Who is Hiring — monthly thread, community-sourced
 *
 * Freshness badges on every listing:
 *   🟢 < 7 days     — FRESH, apply now
 *   🟡 7–30 days    — still good
 *   🔴 31–90 days   — apply with caution
 *   ⛔ > 90 days    — likely expired, shown last
 */

// ─── Freshness Scoring ────────────────────────────────────────────────────────

function freshnessBadge(dateStr: string | null): { badge: string; days: number } {
  if (!dateStr) return { badge: "❓ Unknown date", days: 9999 };
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  if (days < 0)   return { badge: "🟢 Just posted — FRESH", days: 0 };
  if (days <= 7)  return { badge: `🟢 ${days}d ago — FRESH`, days };
  if (days <= 30) return { badge: `🟡 ${days}d ago`, days };
  if (days <= 90) return { badge: `🔴 ${days}d ago — apply with caution`, days };
  return { badge: `⛔ ${days}d ago — likely expired`, days };
}

function matchesLocation(locationField: string, filterLocation: string): boolean {
  if (!filterLocation || filterLocation.toLowerCase() === "worldwide" || filterLocation.toLowerCase() === "remote") return true;
  const loc = locationField.toLowerCase();
  const filter = filterLocation.toLowerCase();
  return (
    loc.includes(filter) ||
    filter.includes(loc) ||
    loc.includes("worldwide") ||
    loc.includes("anywhere") ||
    loc.includes("remote")
  );
}

function highlightKeywords(text: string, keywords: string[]): string {
  if (!keywords.length) return text;
  let result = text;
  for (const kw of keywords) {
    const re = new RegExp(`(${kw})`, "gi");
    result = result.replace(re, "⚡$1");
  }
  return result;
}

// ─── Shared type ─────────────────────────────────────────────────────────────

interface Listing { text: string; days: number; source: string }

// ─── Main Adapter ─────────────────────────────────────────────────────────────

export async function jobsAdapter(options: ExtractOptions): Promise<AdapterResult> {
  const query      = options.url.trim();
  const maxLength  = options.maxLength ?? 8000;
  const location   = options.location ?? "";
  const remoteOnly = options.remoteOnly ?? false;
  const maxAgeDays = options.maxAgeDays ?? 60;
  const keywords   = options.keywords ?? [];

  const [remotiveRes, remoteOkRes, arbeitnowRes, museRes, hnRes] = await Promise.allSettled([
    fetchRemotive(query, location, maxAgeDays, keywords),
    fetchRemoteOK(query, location, maxAgeDays, keywords),
    fetchArbeitnow(query, location, maxAgeDays, keywords, remoteOnly),
    remoteOnly ? Promise.reject("skipped") : fetchMuse(query, location, maxAgeDays, keywords),
    fetchHNHiring(query, location, maxAgeDays, keywords),
  ]);

  const pool: Listing[] = [];
  const sourceStats: Record<string, number> = {};

  const harvest = (res: PromiseSettledResult<{ listings: Listing[] }>, label: string) => {
    if (res.status === "fulfilled") {
      pool.push(...res.value.listings);
      sourceStats[label] = res.value.listings.length;
    } else {
      sourceStats[label] = 0;
    }
  };

  harvest(remotiveRes as PromiseSettledResult<{ listings: Listing[] }>, "Remotive");
  harvest(remoteOkRes as PromiseSettledResult<{ listings: Listing[] }>, "RemoteOK");
  harvest(arbeitnowRes as PromiseSettledResult<{ listings: Listing[] }>, "Arbeitnow");
  harvest(museRes as PromiseSettledResult<{ listings: Listing[] }>, "The Muse");
  harvest(hnRes as PromiseSettledResult<{ listings: Listing[] }>, "HN Hiring");

  if (!pool.length) {
    return {
      raw: [
        `No job listings found for "${query}"${location ? ` in ${location}` : ""}.`,
        "",
        "Tips:",
        "• Try broader terms e.g. \"engineer\" instead of \"senior TypeScript engineer\"",
        "• Set location to \"remote\" for worldwide results",
        "• Increase max_age_days (default: 60)",
        "• Note: FIFO/mining/trades jobs are on specialist boards (myJobsNamibia, SEEK, mining-specific sites) — these sources are tech/remote focused",
      ].join("\n"),
      content_date: null,
      freshness_confidence: "low",
    };
  }

  // Sort: freshest first
  pool.sort((a, b) => a.days - b.days);

  const freshCount = pool.filter(l => l.days <= 7).length;
  const goodCount  = pool.filter(l => l.days > 7 && l.days <= 30).length;
  const staleCount = pool.filter(l => l.days > 30).length;

  const sourceSummary = Object.entries(sourceStats)
    .map(([src, n]) => `${src}:${n}`)
    .join("  ");

  const header = [
    `# Job Search: "${query}"${location ? ` · ${location}` : ""}${remoteOnly ? " · remote only" : ""}`,
    `Retrieved: ${new Date().toISOString()}`,
    `Found: ${pool.length} listings — 🟢 ${freshCount} fresh  🟡 ${goodCount} recent  🔴 ${staleCount} older`,
    `Sources: ${sourceSummary}`,
    `⚠️  Sorted freshest first. Check badge before applying.`,
    keywords.length ? `🔍 Watching for: ${keywords.map(k => `⚡${k}`).join(", ")}` : null,
    "",
  ].filter(Boolean).join("\n");

  const body = pool
    .map(l => l.text)
    .join("\n\n─────────────────────────────\n\n");

  const raw = (header + "\n\n" + body).slice(0, maxLength);

  const freshestDays = pool[0]?.days ?? 9999;
  const newestDate = freshestDays < 9999
    ? new Date(Date.now() - freshestDays * 86400000).toISOString().slice(0, 10)
    : null;

  return {
    raw,
    content_date: newestDate,
    freshness_confidence: freshestDays <= 7 ? "high" : freshestDays <= 30 ? "medium" : "low",
  };
}

// ─── Source: Remotive ─────────────────────────────────────────────────────────

async function fetchRemotive(
  query: string, location: string, maxAgeDays: number, keywords: string[]
): Promise<{ listings: Listing[] }> {
  const url = `https://remotive.com/api/remote-jobs?search=${encodeURIComponent(query)}&limit=15`;
  const res = await fetch(url, {
    headers: { "User-Agent": "freshcontext-mcp/0.3.0", "Accept": "application/json" },
  });
  if (!res.ok) throw new Error(`Remotive ${res.status}`);

  const data = await res.json() as {
    jobs: Array<{
      url: string; title: string; company_name: string;
      job_type: string; publication_date: string;
      candidate_required_location: string; salary: string; tags: string[];
    }>;
  };

  const listings = (data.jobs ?? [])
    .filter(j => matchesLocation(j.candidate_required_location ?? "", location))
    .map(j => {
      const { badge, days } = freshnessBadge(j.publication_date);
      if (days > maxAgeDays) return null;
      const text = highlightKeywords([
        `[Remotive] ${j.title} — ${j.company_name}`,
        badge,
        `Location: ${j.candidate_required_location || "Remote"} | Type: ${j.job_type || "N/A"}`,
        j.salary ? `Salary: ${j.salary}` : null,
        j.tags?.length ? `Tags: ${j.tags.slice(0, 6).join(", ")}` : null,
        `Apply: ${j.url}`,
      ].filter(Boolean).join("\n"), keywords);
      return { text, days, source: "remotive" };
    })
    .filter((l): l is Listing => l !== null)
    .slice(0, 8);

  return { listings };
}

// ─── Source: RemoteOK ─────────────────────────────────────────────────────────

async function fetchRemoteOK(
  query: string, location: string, maxAgeDays: number, keywords: string[]
): Promise<{ listings: Listing[] }> {
  const tag = query.toLowerCase().replace(/\s+/g, "-");
  const url = `https://remoteok.com/api?tag=${encodeURIComponent(tag)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "freshcontext-mcp/0.3.0", "Accept": "application/json" },
  });
  if (!res.ok) throw new Error(`RemoteOK ${res.status}`);

  const raw = await res.json() as Array<{
    id?: string; epoch?: number; date?: string;
    company?: string; position?: string;
    tags?: string[]; location?: string;
    salary_min?: number; salary_max?: number; url?: string;
  }>;

  const jobs = raw.filter(j => j.id && j.position);

  const listings = jobs
    .filter(j => matchesLocation(j.location ?? "Remote", location))
    .map(j => {
      const dateStr = j.date ?? (j.epoch ? new Date(j.epoch * 1000).toISOString() : null);
      const { badge, days } = freshnessBadge(dateStr);
      if (days > maxAgeDays) return null;
      const salary = j.salary_min && j.salary_max
        ? `$${(j.salary_min / 1000).toFixed(0)}k–$${(j.salary_max / 1000).toFixed(0)}k`
        : null;
      const text = highlightKeywords([
        `[RemoteOK] ${j.position} — ${j.company ?? "Unknown"}`,
        badge,
        `Location: ${j.location || "Remote Worldwide"}`,
        salary ? `Salary: ${salary}` : null,
        j.tags?.length ? `Tags: ${j.tags.slice(0, 6).join(", ")}` : null,
        j.url ? `Apply: ${j.url}` : null,
      ].filter(Boolean).join("\n"), keywords);
      return { text, days, source: "remoteok" };
    })
    .filter((l): l is Listing => l !== null)
    .slice(0, 8);

  return { listings };
}

// ─── Source: Arbeitnow (NEW) ──────────────────────────────────────────────────
// Free public API — broader than tech boards. Good for non-remote, non-tech roles.

async function fetchArbeitnow(
  query: string, location: string, maxAgeDays: number, keywords: string[], remoteOnly: boolean
): Promise<{ listings: Listing[] }> {
  const params = new URLSearchParams({ search: query });
  if (remoteOnly) params.set("remote", "true");

  const url = `https://arbeitnow.com/api/job-board-api?${params.toString()}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "freshcontext-mcp/0.3.0", "Accept": "application/json" },
  });
  if (!res.ok) throw new Error(`Arbeitnow ${res.status}`);

  const data = await res.json() as {
    data: Array<{
      slug: string; title: string; company_name: string;
      location: string; remote: boolean;
      created_at: number; // unix timestamp
      url: string; tags: string[];
      job_types: string[];
    }>;
  };

  const listings = (data.data ?? [])
    .filter(j => matchesLocation(j.location ?? "", location))
    .map(j => {
      const dateStr = new Date(j.created_at * 1000).toISOString();
      const { badge, days } = freshnessBadge(dateStr);
      if (days > maxAgeDays) return null;
      const text = highlightKeywords([
        `[Arbeitnow] ${j.title} — ${j.company_name}`,
        badge,
        `Location: ${j.location || "Remote"}${j.remote ? " (Remote OK)" : ""}`,
        j.job_types?.length ? `Type: ${j.job_types.join(", ")}` : null,
        j.tags?.length ? `Tags: ${j.tags.slice(0, 6).join(", ")}` : null,
        `Apply: ${j.url}`,
      ].filter(Boolean).join("\n"), keywords);
      return { text, days, source: "arbeitnow" };
    })
    .filter((l): l is Listing => l !== null)
    .slice(0, 8);

  return { listings };
}

// ─── Source: The Muse ─────────────────────────────────────────────────────────
// Fixed: now uses `name` param for text search instead of `category`

async function fetchMuse(
  query: string, location: string, maxAgeDays: number, keywords: string[]
): Promise<{ listings: Listing[] }> {
  const locParam = location && location.toLowerCase() !== "remote"
    ? `&location=${encodeURIComponent(location)}`
    : "&location=Flexible%20%2F%20Remote";

  const url = `https://www.themuse.com/api/public/jobs?name=${encodeURIComponent(query)}${locParam}&page=0&descending=true`;
  const res = await fetch(url, {
    headers: { "User-Agent": "freshcontext-mcp/0.3.0", "Accept": "application/json" },
  });
  if (!res.ok) throw new Error(`The Muse ${res.status}`);

  const data = await res.json() as {
    results: Array<{
      id: number; name: string; publication_date: string;
      company: { name: string };
      locations: Array<{ name: string }>;
      refs: { landing_page: string };
      levels: Array<{ name: string }>;
    }>;
  };

  const listings = (data.results ?? [])
    .map(j => {
      const locationStr = j.locations?.map(l => l.name).join(", ") || "Flexible/Remote";
      const { badge, days } = freshnessBadge(j.publication_date);
      if (days > maxAgeDays) return null;
      const level = j.levels?.map(l => l.name).join(", ") || null;
      const text = highlightKeywords([
        `[The Muse] ${j.name} — ${j.company?.name ?? "Unknown"}`,
        badge,
        `Location: ${locationStr}`,
        level ? `Level: ${level}` : null,
        `Apply: ${j.refs?.landing_page ?? "N/A"}`,
      ].filter(Boolean).join("\n"), keywords);
      return { text, days, source: "themuse" };
    })
    .filter((l): l is Listing => l !== null)
    .slice(0, 8);

  return { listings };
}

// ─── Source: HN Who is Hiring ─────────────────────────────────────────────────
// Fixed: now searches within the actual monthly "Who is Hiring" thread
// instead of all HN comments. Uses the parent_id filter to target the thread.

async function fetchHNHiring(
  query: string, location: string, maxAgeDays: number, keywords: string[]
): Promise<{ listings: Listing[] }> {
  // Step 1: Find the most recent "Ask HN: Who is hiring?" thread
  const threadRes = await fetch(
    `https://hn.algolia.com/api/v1/search?query=Ask+HN+Who+is+hiring&tags=story&hitsPerPage=5`,
    { headers: { "User-Agent": "freshcontext-mcp/0.3.0" } }
  );
  if (!threadRes.ok) throw new Error(`HN thread search ${threadRes.status}`);

  const threadData = await threadRes.json() as {
    hits: Array<{ objectID: string; title: string; created_at: string }>;
  };

  // Pick most recent hiring thread (they post monthly)
  const hiringThread = threadData.hits.find(h =>
    h.title?.toLowerCase().includes("who is hiring")
  );
  if (!hiringThread) throw new Error("HN hiring thread not found");

  // Step 2: Search comments within that thread for the query
  const searchTerms = [query, location].filter(Boolean).join(" ");
  const commentsRes = await fetch(
    `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(searchTerms)}&tags=comment,story_${hiringThread.objectID}&hitsPerPage=10`,
    { headers: { "User-Agent": "freshcontext-mcp/0.3.0" } }
  );
  if (!commentsRes.ok) throw new Error(`HN comments ${commentsRes.status}`);

  const commentsData = await commentsRes.json() as {
    hits: Array<{
      objectID: string; comment_text: string;
      author: string; created_at: string;
    }>;
  };

  const listings = (commentsData.hits ?? [])
    .filter(h => {
      const t = (h.comment_text ?? "").toLowerCase();
      // Must look like a job post, not a meta comment
      return t.length > 50 && (
        t.includes("hiring") || t.includes("remote") ||
        t.includes("full-time") || t.includes("apply") ||
        t.includes("|") // common delimiter in HN job posts
      );
    })
    .map(h => {
      const { badge, days } = freshnessBadge(h.created_at);
      if (days > maxAgeDays) return null;
      const excerpt = (h.comment_text ?? "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 400);
      const text = highlightKeywords([
        `[HN Hiring · ${hiringThread.title}] by ${h.author}`,
        badge,
        excerpt + (excerpt.length >= 400 ? "…" : ""),
        `Source: https://news.ycombinator.com/item?id=${h.objectID}`,
      ].join("\n"), keywords);
      return { text, days, source: "hn" };
    })
    .filter((l): l is Listing => l !== null)
    .slice(0, 6);

  return { listings };
}
