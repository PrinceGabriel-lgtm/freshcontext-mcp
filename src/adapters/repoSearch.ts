import { AdapterResult, ExtractOptions } from "../types.js";
import { sanitizeQuery } from "../security.js";

// Uses GitHub Search API (no auth needed for basic search)
export async function repoSearchAdapter(options: ExtractOptions): Promise<AdapterResult> {
  // Sanitize query input
  const query_input = sanitizeQuery(options.url);
  let query = query_input;

  // If it's a full URL, extract the query param
  try {
    const parsed = new URL(options.url);
    if (parsed.hostname === "github.com" && parsed.pathname.includes("/search")) {
      query = parsed.searchParams.get("q") ?? options.url;
    } else if (parsed.hostname === "github.com") {
      // It's a direct URL — not a search
      query = parsed.pathname.replace("/search", "").trim().replace(/^\//, "");
    }
  } catch {
    // plain string query, use as-is
  }

  const apiUrl = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&order=desc&per_page=10`;

  const res = await fetch(apiUrl, {
    headers: {
      Accept: "application/vnd.github.v3+json",
      "User-Agent": "freshcontext-mcp/0.1.0",
    },
  });

  if (!res.ok) {
    throw new Error(`GitHub Search API error: ${res.status} ${await res.text()}`);
  }

  const data = await res.json() as {
    total_count: number;
    items: Array<{
      full_name: string;
      description: string | null;
      html_url: string;
      stargazers_count: number;
      forks_count: number;
      language: string | null;
      topics: string[];
      pushed_at: string;
      created_at: string;
      open_issues_count: number;
    }>;
  };

  const raw = [
    `Total matching repos: ${data.total_count.toLocaleString()}`,
    `Top ${data.items.length} by stars:\n`,
    ...data.items.map((r, i) =>
      [
        `[${i + 1}] ${r.full_name}`,
        `⭐ ${r.stargazers_count.toLocaleString()} stars | 🍴 ${r.forks_count} forks | Issues: ${r.open_issues_count}`,
        `Language: ${r.language ?? "unknown"}`,
        `Topics: ${r.topics?.join(", ") || "none"}`,
        `Description: ${r.description ?? "N/A"}`,
        `Last push: ${r.pushed_at}`,
        `Created: ${r.created_at}`,
        `URL: ${r.html_url}`,
      ].join("\n")
    ),
  ]
    .join("\n\n")
    .slice(0, options.maxLength ?? 6000);

  // Most recently pushed repo date as content_date
  const dates = data.items.map((r) => r.pushed_at).sort().reverse();

  return {
    raw,
    content_date: dates[0] ?? null,
    freshness_confidence: "high",
  };
}
