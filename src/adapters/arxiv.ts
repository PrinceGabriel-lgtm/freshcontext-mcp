import { AdapterResult, ExtractOptions } from "../types.js";
import type { FreshContextSignalInput } from "../core/types.js";
import { validateUrl } from "../security.js";

export type ArxivSignalSearchInput = {
  query: string;
  maxResults?: number;
  retrievedAt?: string;
  semanticScore?: number;
};

type ParsedArxivEntry = {
  title: string;
  summary: string;
  published: string;
  updated: string;
  id: string;
  authors: string[];
  category: string;
};

const USER_AGENT = "freshcontext-mcp/0.1.7 (https://github.com/PrinceGabriel-lgtm/freshcontext-mcp)";
const DEFAULT_ARXIV_SIGNAL_SCORE = 0.8;

function buildArxivApiUrl(input: string, maxResults = 10): string {
  const trimmed = input.trim();
  const safeMaxResults = Number.isFinite(maxResults)
    ? Math.max(1, Math.min(Math.trunc(maxResults), 50))
    : 10;

  return trimmed.startsWith("http")
    ? validateUrl(trimmed, "arxiv")
    : `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(trimmed)}&start=0&max_results=${safeMaxResults}&sortBy=relevance&sortOrder=descending`;
}

async function fetchArxivXml(apiUrl: string): Promise<string> {
  const res = await fetch(apiUrl, {
    headers: { "User-Agent": USER_AGENT },
  });

  if (!res.ok) throw new Error(`arXiv API error: ${res.status} ${res.statusText}`);

  return res.text();
}

function getTag(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return m ? m[1].trim().replace(/\s+/g, " ") : "";
}

function getAttr(block: string, tag: string, attr: string): string {
  const m = block.match(new RegExp(`<${tag}[^>]*${attr}="([^"]*)"`, "i"));
  return m ? m[1].trim() : "";
}

function normalizeArxivUrl(id: string): string {
  return id.replace("http://arxiv.org/abs/", "https://arxiv.org/abs/");
}

function parseArxivEntries(xml: string): ParsedArxivEntry[] {
  return [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((match) => {
    const block = match[1];
    const authorMatches = [...block.matchAll(/<author>([\s\S]*?)<\/author>/g)];
    const authors = authorMatches
      .map(a => getTag(a[1], "name"))
      .filter(Boolean)
      .slice(0, 4);

    return {
      title: getTag(block, "title").replace(/\n/g, " "),
      summary: getTag(block, "summary").replace(/\n/g, " "),
      published: getTag(block, "published"),
      updated: getTag(block, "updated"),
      id: normalizeArxivUrl(getTag(block, "id")),
      authors,
      category: getAttr(block, "arxiv:primary_category", "term") ||
        getAttr(block, "category", "term"),
    };
  });
}

function formatArxivEntry(entry: ParsedArxivEntry, index: number): string {
  const published = entry.published.slice(0, 10);
  const updated = entry.updated.slice(0, 10);
  const authors = entry.authors.join(", ");
  const summary = entry.summary.slice(0, 300);

  return [
    `[${index + 1}] ${entry.title}`,
    `Authors: ${authors || "Unknown"}`,
    `Published: ${published}${updated !== published ? ` (updated ${updated})` : ""}`,
    entry.category ? `Category: ${entry.category}` : null,
    `Abstract: ${summary}\u00e2\u20ac\u00a6`,
    `Link: ${entry.id}`,
  ].filter(Boolean).join("\n");
}

/**
 * arXiv adapter uses the official arXiv API.
 * Accepts a search query or a direct arXiv API URL.
 * Docs: https://arxiv.org/help/api/user-manual
 */
export async function arxivAdapter(options: ExtractOptions): Promise<AdapterResult> {
  const input = options.url.trim();
  const apiUrl = buildArxivApiUrl(input);
  const xml = await fetchArxivXml(apiUrl);
  const entries = parseArxivEntries(xml);

  if (!entries.length) {
    return { raw: "No results found for this query.", content_date: null, freshness_confidence: "low" };
  }

  const papers = entries.map(formatArxivEntry);
  const raw = papers.join("\n\n").slice(0, options.maxLength ?? 6000);

  const dates = entries
    .map(entry => entry.published.slice(0, 10))
    .filter(Boolean)
    .sort()
    .reverse();

  const content_date = dates[0] ?? null;

  return { raw, content_date, freshness_confidence: content_date ? "high" : "medium" };
}

export async function searchArxivSignals(input: ArxivSignalSearchInput): Promise<FreshContextSignalInput[]> {
  const query = input.query.trim();
  const apiUrl = buildArxivApiUrl(query, input.maxResults);
  const xml = await fetchArxivXml(apiUrl);
  const entries = parseArxivEntries(xml);
  const retrievedAt = input.retrievedAt ?? new Date().toISOString();
  const semanticScore = input.semanticScore ?? DEFAULT_ARXIV_SIGNAL_SCORE;

  return entries.map((entry): FreshContextSignalInput => ({
    title: entry.title,
    content: entry.summary,
    source: entry.id,
    source_type: "arxiv",
    published_at: entry.published || null,
    retrieved_at: retrievedAt,
    semantic_score: semanticScore,
    metadata: {
      authors: entry.authors,
      category: entry.category || null,
      updated_at: entry.updated || null,
      query,
    },
  }));
}
