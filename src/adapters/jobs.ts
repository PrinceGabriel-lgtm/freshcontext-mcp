import { AdapterResult, ExtractOptions } from "../types.js";

/**
 * Jobs adapter v2 — 4 sources, freshness badges, location + keyword filtering.
 *
 * Sources (all no-auth):
 *   - Remotive       — remote jobs, location filterable
 *   - RemoteOK       — pure remote, salary data, unix timestamps
 *   - The Muse       — structured jobs, location + category
 *   - HN Who is Hiring — community-sourced, raw but real
 *
 * Every listing gets a freshness badge:
 *   🟢 < 7 days     — FRESH, apply now
 *   🟡 7–30 days    — still good
 *   🔴 31–90 days   — apply with caution
 *   ⛔ > 90 days    — likely expired, shown last
 *
 * This adapter was the whole reason freshcontext exists.
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
  return loc.includes(filter) || filter.includes(loc) || loc.includes("worldwide") || loc.includes("anywhere") || loc.includes("remote");
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

// ─── Main Adapter ─────────────────────────────────────────────────────────────

export async function jobsAdapter(options: ExtractOptions): Promise<AdapterResult> {
  const query      = options.url.trim();
  const maxLength  = options.maxLength ?? 8000;
  const location   = options.location ?? "";
  const remoteOnly = options.remoteOnly ?? false;
  const maxAgeDays = options.maxAgeDays ?? 60;
  const keywords   = options.keywords ?? [];
  const perSource  = Math.floor(maxLength / 4);

  const [remotiveRes, remoteOkRes, museRes, hnRes] = await Promise.allSettled([
    fetchRemotive(query, location, maxAgeDays, keywords, perSource),
    fetchRemoteOK(query, location, maxAgeDays, keywords, perSource),
    remoteOnly ? Promise.reject("skipped (remote_only mode)") : fetchMuse(query, location, maxAgeDays, keywords, perSource),
    fetchHNHiring(query, location, maxAgeDays, keywords, perSource),
  ]);

  // Collect all listings into one pool, sort by freshness
  interface Listing { text: string; days: number; source: string }
  const pool: Listing[] = [];

  const harvest = (res: PromiseSettledResult<{ listings: Listing[] }>, label: string) => {
    if (res.status === "fulfilled") pool.push(...res.value.listings);
    // silently skip rejected sources — don't clutter output
  };

  harvest(remotiveRes as PromiseSettledResult<{ listings: Listing[] }>, "Remotive");
  harvest(remoteOkRes as PromiseSettledResult<{ listings: Listing[] }>, "RemoteOK");
  harvest(museRes as PromiseSettledResult<{ listings: Listing[] }>, "The Muse");
  harvest(hnRes as PromiseSettledResult<{ listings: Listing[] }>, "HN");

  if (!pool.length) {
    return {
      raw: `No job listings found for "${query}"${location ? ` in ${location}` : ""}.\n\nTips:\n• Try broader terms e.g. "engineer" instead of "senior TypeScript engineer"\n• Set location to "remote" for worldwide results\n• Increase max_age_days`,
      content_date: null,
      freshness_confidence: "low",
    };
  }

  // Sort: freshest first, expired listings last
  pool.sort((a, b) => a.days - b.days);

  const freshCount = pool.filter(l => l.days <= 7).length;
  const goodCount  = pool.filter(l => l.days > 7 && l.days <= 30).length;
  const staleCount = pool.filter(l => l.days > 30).length;

  const header = [
    `# Job Search: "${query}"${location ? ` · ${location}` : ""}${remoteOnly ? " · remote only" : ""}`,
    `Retrieved: ${new Date().toISOString()}`,
    `Found: ${pool.length} listings — 🟢 ${freshCount} fresh  🟡 ${goodCount} recent  🔴 ${staleCount} older`,
    `⚠️  Listings sorted freshest first. Check the date badge before you apply.`,
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
  query: string, location: string, maxAgeDays: number, keywords: string[], maxLength: number
): Promise<{ listings: Array<{ text: string; days: number; source: string }> }> {
  const url = `https://remotive.com/api/remote-jobs?search=${encodeURIComponent(query)}&limit=15`;
  const res = await fetch(url, {
    headers: { "User-Agent": "freshcontext-mcp/0.2.0", "Accept": "application/json" },
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
        `${badge}`,
        `Location: ${j.candidate_required_location || "Remote"} | Type: ${j.job_type || "N/A"}`,
        j.salary ? `Salary: ${j.salary}` : null,
        j.tags?.length ? `Tags: ${j.tags.slice(0, 6).join(", ")}` : null,
        `Apply: ${j.url}`,
      ].filter(Boolean).join("\n"), keywords);
      return { text, days, source: "remotive" };
    })
    .filter((l): l is { text: string; days: number; source: string } => l !== null)
    .slice(0, 8);

  return { listings };
}

// ─── Source: RemoteOK ─────────────────────────────────────────────────────────

async function fetchRemoteOK(
  query: string, location: string, maxAgeDays: number, keywords: string[], maxLength: number
): Promise<{ listings: Array<{ text: string; days: number; source: string }> }> {
  const tag = query.toLowerCase().replace(/\s+/g, "-");
  const url = `https://remoteok.com/api?tag=${encodeURIComponent(tag)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "freshcontext-mcp/0.2.0", "Accept": "application/json" },
  });
  if (!res.ok) throw new Error(`RemoteOK ${res.status}`);

  const raw = await res.json() as Array<{
    id?: string; epoch?: number; date?: string;
    company?: string; position?: string;
    tags?: string[]; location?: string;
    salary_min?: number; salary_max?: number; url?: string;
  }>;

  // First element is a legal notice object, skip it
  const jobs = raw.filter(j => j.id && j.position);

  const listings = jobs
    .filter(j => matchesLocation(j.location ?? "Remote", location))
    .map(j => {
      const dateStr = j.date ?? (j.epoch ? new Date(j.epoch * 1000).toISOString() : null);
      const { badge, days } = freshnessDate(dateStr);
      if (days > maxAgeDays) return null;
      const salary = j.salary_min && j.salary_max
        ? `$${(j.salary_min / 1000).toFixed(0)}k–$${(j.salary_max / 1000).toFixed(0)}k`
        : null;
      const text = highlightKeywords([
        `[RemoteOK] ${j.position} — ${j.company ?? "Unknown"}`,
        `${badge}`,
        `Location: ${j.location || "Remote Worldwide"}`,
        salary ? `Salary: ${salary}` : null,
        j.tags?.length ? `Tags: ${j.tags.slice(0, 6).join(", ")}` : null,
        j.url ? `Apply: ${j.url}` : null,
      ].filter(Boolean).join("\n"), keywords);
      return { text, days, source: "remoteok" };
    })
    .filter((l): l is { text: string; days: number; source: string } => l !== null)
    .slice(0, 8);

  return { listings };
}

// ─── Source: The Muse ─────────────────────────────────────────────────────────

async function fetchMuse(
  query: string, location: string, maxAgeDays: number, keywords: string[], maxLength: number
): Promise<{ listings: Array<{ text: string; days: number; source: string }> }> {
  const locParam = location && location.toLowerCase() !== "remote"
    ? `&location=${encodeURIComponent(location)}`
    : "&location=Flexible%20%2F%20Remote";

  const url = `https://www.themuse.com/api/public/jobs?category=${encodeURIComponent(query)}${locParam}&page=0&descending=true`;
  const res = await fetch(url, {
    headers: { "User-Agent": "freshcontext-mcp/0.2.0", "Accept": "application/json" },
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
      const { badge, days } = freshnessDate(j.publication_date);
      if (days > maxAgeDays) return null;
      const level = j.levels?.map(l => l.name).join(", ") || null;
      const text = highlightKeywords([
        `[The Muse] ${j.name} — ${j.company?.name ?? "Unknown"}`,
        `${badge}`,
        `Location: ${locationStr}`,
        level ? `Level: ${level}` : null,
        `Apply: ${j.refs?.landing_page ?? "N/A"}`,
      ].filter(Boolean).join("\n"), keywords);
      return { text, days, source: "themuse" };
    })
    .filter((l): l is { text: string; days: number; source: string } => l !== null)
    .slice(0, 8);

  return { listings };
}

// ─── Source: HN Who is Hiring ─────────────────────────────────────────────────

async function fetchHNHiring(
  query: string, location: string, maxAgeDays: number, keywords: string[], maxLength: number
): Promise<{ listings: Array<{ text: string; days: number; source: string }> }> {
  const searchQ = [query, location, "hiring"].filter(Boolean).join(" ");
  const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(searchQ)}&tags=comment&hitsPerPage=10`;
  const res = await fetch(url, { headers: { "User-Agent": "freshcontext-mcp/0.2.0" } });
  if (!res.ok) throw new Error(`HN ${res.status}`);

  const data = await res.json() as {
    hits: Array<{
      objectID: string; comment_text: string;
      author: string; created_at: string;
    }>;
  };

  const listings = (data.hits ?? [])
    .filter(h => {
      const t = (h.comment_text ?? "").toLowerCase();
      return t.includes("hiring") || t.includes("remote") || t.includes("full-time") || t.includes("apply");
    })
    .map(h => {
      const { badge, days } = freshnessDate(h.created_at);
      if (days > maxAgeDays) return null;
      const excerpt = (h.comment_text ?? "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 350);
      const text = highlightKeywords([
        `[HN Hiring] Posted by ${h.author}`,
        `${badge}`,
        excerpt + (excerpt.length >= 350 ? "…" : ""),
        `Source: https://news.ycombinator.com/item?id=${h.objectID}`,
      ].join("\n"), keywords);
      return { text, days, source: "hn" };
    })
    .filter((l): l is { text: string; days: number; source: string } => l !== null)
    .slice(0, 6);

  return { listings };
}

// ─── Shared date helper ───────────────────────────────────────────────────────

function freshnessDate(dateStr: string | null | undefined): { badge: string; days: number } {
  return freshnessBadge(dateStr ?? null);
}
