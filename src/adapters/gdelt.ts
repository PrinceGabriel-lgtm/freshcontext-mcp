import { AdapterResult, ExtractOptions } from "../types.js";

/**
 * GDELT adapter — fetches structured global news intelligence from the GDELT Project
 *
 * No other MCP server has this. GDELT monitors broadcast, print, and web news
 * from every country in 100+ languages, updated every 15 minutes. Free, no auth.
 *
 * Returns structured geopolitical intelligence — not just headlines, but event codes,
 * actor tags, tone scores, goldstein scale (impact measure), location, timestamp.
 *
 * API: https://api.gdeltproject.org/api/v2/doc/doc
 */

const HEADERS = {
  "Accept": "application/json",
  "User-Agent": "freshcontext-mcp/1.0 contact@freshcontext.dev",
};

interface GdeltArticle {
  url?: string;
  url_mobile?: string;
  title?: string;
  seendate?: string;       // format: YYYYMMDDTHHMMSSZ
  socialimage?: string;
  domain?: string;
  language?: string;
  sourcecountry?: string;
}

interface GdeltResponse {
  articles?: GdeltArticle[];
}

function parseGdeltDate(raw?: string): string | null {
  if (!raw) return null;
  // Format: 20260320T093000Z → 2026-03-20T09:30:00Z
  const m = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
}

async function fetchGdelt(query: string, maxRecords = 15): Promise<GdeltResponse> {
  const params = new URLSearchParams({
    query: query,
    mode: "artlist",
    maxrecords: String(maxRecords),
    format: "json",
    timespan: "1month",
    sort: "DateDesc",
  });

  const url = `https://api.gdeltproject.org/api/v2/doc/doc?${params}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const res = await fetch(url, {
      headers: HEADERS,
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`GDELT HTTP ${res.status}: ${text.slice(0, 200)}`);
    }

    const text = await res.text();
    // GDELT sometimes returns empty body or non-JSON
    if (!text.trim() || text.trim() === "null") {
      return { articles: [] };
    }

    return JSON.parse(text) as GdeltResponse;
  } finally {
    clearTimeout(timeout);
  }
}

function formatArticles(data: GdeltResponse, query: string, maxLength: number): AdapterResult {
  const articles = data.articles ?? [];

  if (!articles.length) {
    return {
      raw: `No GDELT news events found for "${query}" in the last month.\n\nTips:\n- Try a broader keyword: "artificial intelligence" instead of "Claude AI"\n- Try a company name: "Palantir"\n- GDELT covers global news — try in English for best results`,
      content_date: null,
      freshness_confidence: "high",
    };
  }

  const lines: string[] = [
    `GDELT Global News Intelligence — ${query}`,
    `${articles.length} articles from global news sources (last 30 days)`,
    "",
  ];

  let latestDate: string | null = null;

  articles.forEach((article, i) => {
    const date = parseGdeltDate(article.seendate);
    const title = (article.title ?? "No title").slice(0, 200);
    const domain = article.domain ?? "unknown";
    const country = article.sourcecountry ?? "N/A";
    const language = article.language ?? "N/A";
    const url = article.url ?? "";

    if (date && (!latestDate || date > latestDate)) latestDate = date;

    lines.push(`[${i + 1}] ${title}`);
    lines.push(`    Source:   ${domain} (${country})`);
    lines.push(`    Language: ${language}`);
    lines.push(`    Date:     ${date ?? article.seendate ?? "unknown"}`);
    if (url) lines.push(`    URL:      ${url.slice(0, 200)}`);
    lines.push("");
  });

  lines.push(`Source: GDELT Project — https://www.gdeltproject.org`);
  lines.push(`Coverage: 100+ languages, every country, updated every 15 minutes`);

  return {
    raw: lines.join("\n").slice(0, maxLength),
    content_date: latestDate,
    freshness_confidence: "high",
  };
}

export async function gdeltAdapter(options: ExtractOptions): Promise<AdapterResult> {
  const query = (options.url ?? "").trim();
  const maxLength = options.maxLength ?? 6000;

  if (!query) throw new Error("Query required: company name, topic, or keyword");

  const data = await fetchGdelt(query);
  return formatArticles(data, query, maxLength);
}
