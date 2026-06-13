#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { githubAdapter } from "./adapters/github.js";
import { scholarAdapter } from "./adapters/scholar.js";
import { hackerNewsAdapter } from "./adapters/hackernews.js";
import { ycAdapter } from "./adapters/yc.js";
import { repoSearchAdapter } from "./adapters/repoSearch.js";
import { packageTrendsAdapter } from "./adapters/packageTrends.js";
import { redditAdapter } from "./adapters/reddit.js";
import { productHuntAdapter } from "./adapters/productHunt.js";
import { financeAdapter } from "./adapters/finance.js";
import { arxivAdapter } from "./adapters/arxiv.js";
import { jobsAdapter } from "./adapters/jobs.js";
import { changelogAdapter } from "./adapters/changelog.js";
import { govContractsAdapter } from "./adapters/govcontracts.js";
import { secFilingsAdapter } from "./adapters/secFilings.js";
import { gdeltAdapter } from "./adapters/gdelt.js";
import { gebizAdapter } from "./adapters/gebiz.js";
import { stampFreshness, formatForLLM } from "./tools/freshnessStamp.js";
import {
  EvaluateContextInputError,
  evaluateContextInput,
  formatEvaluateContextResult,
} from "./tools/evaluateContext.js";
import { SecurityError, formatSecurityError } from "./security.js";

const server = new McpServer({
  name: "freshcontext-mcp",
  version: "0.3.21",
});

const signalInputSchema = z.object({
  id: z.string().optional(),
  source: z.string().min(1).describe("Source URL, URI, document id, or stable source label."),
  source_type: z.string().optional().describe("Source type such as arxiv, jobs, official_docs, custom, or user_provided."),
  title: z.string().optional(),
  content: z.string().optional(),
  published_at: z.string().nullable().optional(),
  content_date: z.string().nullable().optional(),
  retrieved_at: z.string().nullable().optional(),
  semantic_score: z.number().optional().describe("Optional relevance score from 0..1. Core clamps out-of-range values."),
  date_confidence: z.enum(["high", "medium", "low", "unknown"]).optional(),
  freshness_confidence: z.enum(["high", "medium", "low"]).optional(),
  status: z.enum(["success", "partial", "stale", "failed", "unknown"]).optional(),
  metadata: z.record(z.unknown()).optional(),
}).passthrough();

// Tool: evaluate_context
server.registerTool(
  "evaluate_context",
  {
    description:
      "Evaluate caller-provided candidate context and return decision-ready output. This is the primary FreshContext judgment path: it does not fetch, crawl, scrape, browse, read folders, or call adapters.",
    inputSchema: z.object({
      profile: z.string().min(1).describe("Source Profile id, e.g. academic_research, jobs_opportunities, market_finance, official_docs, local_custom."),
      intent: z.string().min(1).describe("Intent Profile id, e.g. citation_check, student_research, developer_adoption, job_search, market_watch, business_due_diligence, medical_literature_triage."),
      signals: z.array(signalInputSchema).min(1).max(100).describe("Candidate context items provided by the caller. FreshContext evaluates these; it does not retrieve them."),
      now: z.string().optional().describe("Optional ISO timestamp for deterministic evaluation."),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async ({ profile, intent, signals, now }) => {
    try {
      const result = evaluateContextInput({ profile, intent, signals, now });
      return { content: [{ type: "text", text: formatEvaluateContextResult(result) }] };
    } catch (err) {
      if (err instanceof EvaluateContextInputError) {
        return { content: [{ type: "text", text: `[FreshContext evaluate_context error]\n${err.message}` }] };
      }
      return { content: [{ type: "text", text: formatSecurityError(err) }] };
    }
  }
);

// ─── Reference adapter: extract_github ───────────────────────────────────────
server.registerTool(
  "extract_github",
  {
    description:
      "Extract real-time data from a GitHub repository — README, stars, forks, language, topics, last commit. Returns timestamped freshcontext.",
    inputSchema: z.object({
      url: z.string().url().describe("Full GitHub repo URL e.g. https://github.com/owner/repo"),
      max_length: z.number().optional().default(6000).describe("Max content length"),
    }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ url, max_length }) => {
    try {
      const result = await githubAdapter({ url, maxLength: max_length });
      const ctx = stampFreshness(result, { url, maxLength: max_length }, "github");
      return { content: [{ type: "text", text: formatForLLM(ctx) }] };
    } catch (err) {
      return { content: [{ type: "text", text: formatSecurityError(err) }] };
    }
  }
);

// ─── Tool: extract_scholar ───────────────────────────────────────────────────
server.registerTool(
  "extract_scholar",
  {
    description:
      "Extract research results from a Google Scholar search URL. Returns titles, authors, publication years, and snippets — all timestamped.",
    inputSchema: z.object({
      url: z.string().url().describe("Google Scholar search URL e.g. https://scholar.google.com/scholar?q=..."),
      max_length: z.number().optional().default(6000),
    }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ url, max_length }) => {
    try {
      const result = await scholarAdapter({ url, maxLength: max_length });
      const ctx = stampFreshness(result, { url, maxLength: max_length }, "google_scholar");
      return { content: [{ type: "text", text: formatForLLM(ctx) }] };
    } catch (err) {
      return { content: [{ type: "text", text: formatSecurityError(err) }] };
    }
  }
);

// ─── Tool: extract_hackernews ────────────────────────────────────────────────
server.registerTool(
  "extract_hackernews",
  {
    description:
      "Extract top stories or search results from Hacker News. Accepts an HN/Algolia URL or a plain search query while preserving the url field for compatibility.",
    inputSchema: z.object({
      url: z.string().min(1).describe("HN URL e.g. https://news.ycombinator.com/news, Algolia API URL, or search query e.g. 'browser agents'"),
      max_length: z.number().optional().default(4000),
    }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ url, max_length }) => {
    try {
      const result = await hackerNewsAdapter({ url, maxLength: max_length });
      const ctx = stampFreshness(result, { url, maxLength: max_length }, "hackernews");
      return { content: [{ type: "text", text: formatForLLM(ctx) }] };
    } catch (err) {
      return { content: [{ type: "text", text: formatSecurityError(err) }] };
    }
  }
);

// ─── Tool: extract_yc ──────────────────────────────────────────────────────────
server.registerTool(
  "extract_yc",
  {
    description:
      "Scrape YC company listings. Use https://www.ycombinator.com/companies?query=KEYWORD to find startups in a space. Returns name, batch, tags, description per company with freshness timestamp.",
    inputSchema: z.object({
      url: z.string().url().describe("YC companies URL e.g. https://www.ycombinator.com/companies?query=mcp"),
      max_length: z.number().optional().default(6000),
    }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ url, max_length }) => {
    try {
      const result = await ycAdapter({ url, maxLength: max_length });
      const ctx = stampFreshness(result, { url, maxLength: max_length }, "yc");
      return { content: [{ type: "text", text: formatForLLM(ctx) }] };
    } catch (err) {
      return { content: [{ type: "text", text: formatSecurityError(err) }] };
    }
  }
);

// ─── Tool: search_repos ──────────────────────────────────────────────────────
server.registerTool(
  "search_repos",
  {
    description:
      "Search GitHub for repositories matching a keyword or topic. Returns top results by stars with activity signals. Use to find competitors, similar tools, or related projects.",
    inputSchema: z.object({
      query: z.string().describe("Search query e.g. 'mcp server typescript' or 'cashflow prediction python'"),
      max_length: z.number().optional().default(6000),
    }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ query, max_length }) => {
    try {
      const result = await repoSearchAdapter({ url: query, maxLength: max_length });
      const ctx = stampFreshness(result, { url: query, maxLength: max_length }, "reposearch");
      return { content: [{ type: "text", text: formatForLLM(ctx) }] };
    } catch (err) {
      return { content: [{ type: "text", text: formatSecurityError(err) }] };
    }
  }
);

// ─── Tool: package_trends ────────────────────────────────────────────────────
server.registerTool(
  "package_trends",
  {
    description:
      "Look up npm and PyPI package metadata — version history, release cadence, last updated. Use to gauge ecosystem activity around a tool or dependency. Supports comma-separated list of packages.",
    inputSchema: z.object({
      packages: z.string().describe("Package name(s) e.g. 'langchain' or 'npm:zod,pypi:fastapi'"),
      max_length: z.number().optional().default(5000),
    }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ packages, max_length }) => {
    try {
      const result = await packageTrendsAdapter({ url: packages, maxLength: max_length });
      const ctx = stampFreshness(result, { url: packages, maxLength: max_length }, "packagetrends");
      return { content: [{ type: "text", text: formatForLLM(ctx) }] };
    } catch (err) {
      return { content: [{ type: "text", text: formatSecurityError(err) }] };
    }
  }
);

// ─── Tool: extract_arxiv ─────────────────────────────────────────────────────
server.registerTool(
  "extract_arxiv",
  {
    description:
      "Search arXiv for research papers via the official API. Pass a topic, keyword, or full arXiv API URL. Returns titles, authors, publication dates, primary category, and abstracts — all timestamped.",
    inputSchema: z.object({
      url: z.string().describe("Search query e.g. 'temporal retrieval', or a full arXiv API URL"),
      max_length: z.number().optional().default(6000),
    }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ url, max_length }) => {
    try {
      const result = await arxivAdapter({ url, maxLength: max_length });
      const ctx = stampFreshness(result, { url, maxLength: max_length }, "arxiv");
      return { content: [{ type: "text", text: formatForLLM(ctx) }] };
    } catch (err) {
      return { content: [{ type: "text", text: formatSecurityError(err) }] };
    }
  }
);

// ─── Tool: extract_finance ───────────────────────────────────────────────────
server.registerTool(
  "extract_finance",
  {
    description:
      "No-key stock quote data via Stooq — close, open, high, low, volume, quote timestamp, and source. Accepts up to 5 comma-separated tickers. Returns timestamped freshcontext only for successful observations.",
    inputSchema: z.object({
      url: z.string().describe("Ticker symbol(s) e.g. 'AAPL' or 'MSFT,GOOG,PLTR'"),
      max_length: z.number().optional().default(5000),
    }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ url, max_length }) => {
    try {
      const result = await financeAdapter({ url, maxLength: max_length });
      const ctx = stampFreshness(result, { url, maxLength: max_length }, "finance");
      return { content: [{ type: "text", text: formatForLLM(ctx) }] };
    } catch (err) {
      return { content: [{ type: "text", text: formatSecurityError(err) }] };
    }
  }
);

// ─── Tool: extract_reddit ────────────────────────────────────────────────────
server.registerTool(
  "extract_reddit",
  {
    description:
      "Extract posts and community sentiment from Reddit via the public JSON API. Accepts a subreddit URL (https://www.reddit.com/r/MachineLearning/.json), a search URL, or a subreddit shorthand ('r/MachineLearning'). Returns titles, authors, scores, comment counts, and per-post timestamps.",
    inputSchema: z.object({
      url: z.string().describe("Subreddit URL, search URL, or 'r/<subreddit>' shorthand"),
      max_length: z.number().optional().default(6000),
    }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ url, max_length }) => {
    try {
      const result = await redditAdapter({ url, maxLength: max_length });
      const ctx = stampFreshness(result, { url, maxLength: max_length }, "reddit");
      return { content: [{ type: "text", text: formatForLLM(ctx) }] };
    } catch (err) {
      return { content: [{ type: "text", text: formatSecurityError(err) }] };
    }
  }
);

// ─── Tool: extract_producthunt ───────────────────────────────────────────────
server.registerTool(
  "extract_producthunt",
  {
    description:
      "Recent Product Hunt launches by keyword or topic. Uses the Product Hunt GraphQL API (with HTML scrape fallback). Returns names, taglines, vote counts, comment counts, topics, and launch dates — all timestamped.",
    inputSchema: z.object({
      url: z.string().describe("Search query e.g. 'mcp ai agents' or a Product Hunt topic URL"),
      max_length: z.number().optional().default(6000),
    }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ url, max_length }) => {
    try {
      const result = await productHuntAdapter({ url, maxLength: max_length });
      const ctx = stampFreshness(result, { url, maxLength: max_length }, "producthunt");
      return { content: [{ type: "text", text: formatForLLM(ctx) }] };
    } catch (err) {
      return { content: [{ type: "text", text: formatSecurityError(err) }] };
    }
  }
);

// ─── Shared freshness filter for composite tools ────────────────────────────
// Used by all 5 composite tools to implement min_freshness_score filtering.
// When a section's freshness score falls below the threshold, it's replaced
// with a staleness warning rather than omitted — preserving output structure.
type AdapterResultRaw = { raw: string; content_date: string | null; freshness_confidence: "high" | "medium" | "low" };

function sectionWithFreshnessCheck(
  label: string,
  result: PromiseSettledResult<AdapterResultRaw>,
  adapterName: string,
  minScore?: number,
  errorWord = "Unavailable"
): string {
  if (result.status !== "fulfilled") {
    return `## ${label}\n[${errorWord}: ${(result as PromiseRejectedResult).reason}]`;
  }
  if (minScore !== undefined && minScore > 0) {
    const ctx = stampFreshness(result.value, { url: "", maxLength: 0 }, adapterName);
    if (ctx.freshness_score !== null && ctx.freshness_score < minScore) {
      return `## ${label}\n[Stale — freshness_score: ${ctx.freshness_score}/100 is below min_freshness_score threshold of ${minScore}. Content date: ${result.value.content_date ?? "unknown"}. Re-query for fresher data.]`;
    }
  }
  return `## ${label}\n${result.value.raw}`;
}

// ─── Tool: extract_landscape ─────────────────────────────────────────────────
server.registerTool(
  "extract_landscape",
  {
    description:
      "Composite intelligence tool. Given a project idea or keyword, simultaneously queries YC startups, GitHub repos, HN, Reddit, Product Hunt, and package registries to answer: Who is building this? Is it funded? What's getting traction? Returns a unified 6-source timestamped landscape report.",
    inputSchema: z.object({
      topic: z.string().describe("Your project idea or keyword e.g. 'mcp server' or 'cashflow prediction'"),
      max_length: z.number().optional().default(10000),
    }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ topic, max_length }) => {
    const perSection = Math.floor((max_length ?? 8000) / 4);

    const [ycResult, repoResult, hnResult, pkgResult] = await Promise.allSettled([
      ycAdapter({ url: `https://www.ycombinator.com/companies?query=${encodeURIComponent(topic)}`, maxLength: perSection }),
      repoSearchAdapter({ url: topic, maxLength: perSection }),
      hackerNewsAdapter({ url: `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(topic)}&tags=story&hitsPerPage=15`, maxLength: perSection }),
      packageTrendsAdapter({ url: topic, maxLength: perSection }),
    ]);

    const section = (label: string, result: PromiseSettledResult<{ raw: string; content_date: string | null; freshness_confidence: string }>) =>
      result.status === "fulfilled"
        ? `## ${label}\n${result.value.raw}`
        : `## ${label}\n[Error: ${(result as PromiseRejectedResult).reason}]`;

    const combined = [
      `# Landscape Report: "${topic}"`,
      `Generated: ${new Date().toISOString()}`,
      "",
      section("🚀 YC Startups in this space", ycResult),
      section("📦 Top GitHub repos", repoResult),
      section("💬 HN sentiment (last month)", hnResult),
      section("📊 Package ecosystem", pkgResult),
    ].join("\n\n");

    return { content: [{ type: "text", text: combined }] };
  }
);

// ─── Tool: search_jobs ───────────────────────────────────────────────────────
server.registerTool(
  "search_jobs",
  {
    description:
      "Search for real-time job listings with freshness badges on every result — so you never apply to a role that closed months ago. Sources: Remotive + RemoteOK + The Muse + HN 'Who is Hiring'. Supports location filtering, remote-only mode, keyword spotting (e.g. FIFO), and max age filtering. Returns timestamped freshcontext sorted freshest first.",
    inputSchema: z.object({
      query: z.string().describe("Job search query e.g. 'typescript', 'mining engineer', 'FIFO operator', 'data analyst'"),
      location: z.string().optional().describe("Country, city, or 'remote' / 'worldwide' e.g. 'South Africa', 'Australia', 'remote'"),
      remote_only: z.boolean().optional().default(false).describe("Only return remote-friendly listings"),
      max_age_days: z.number().optional().default(60).describe("Hide listings older than N days (default 60, use 7 for very fresh only)"),
      keywords: z.array(z.string()).optional().default([]).describe("Keywords to highlight in results e.g. ['FIFO', 'underground', 'contract']"),
      max_length: z.number().optional().default(8000),
    }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ query, location, remote_only, max_age_days, keywords, max_length }) => {
    try {
      const result = await jobsAdapter({
        url: query,
        maxLength: max_length,
        location: location ?? "",
        remoteOnly: remote_only,
        maxAgeDays: max_age_days,
        keywords: keywords ?? [],
      });
      const ctx = stampFreshness(result, { url: query, maxLength: max_length }, "jobs");
      return { content: [{ type: "text", text: formatForLLM(ctx) }] };
    } catch (err) {
      return { content: [{ type: "text", text: formatSecurityError(err) }] };
    }
  }
);

// ─── Tool: extract_changelog ────────────────────────────────────────────────
server.registerTool(
  "extract_changelog",
  {
    description:
      "Extract update history from any product, repo, or package. Accepts a GitHub URL (uses Releases API), an npm package name, or any website URL (auto-discovers /changelog, /releases, /CHANGELOG.md). Returns version numbers, release dates, and entry content — all timestamped. Use this to check if a tool is actively maintained, when a feature shipped, or how fast a team moves.",
    inputSchema: z.object({
      url: z.string().describe(
        "GitHub repo URL (https://github.com/owner/repo), npm package name (e.g. 'freshcontext-mcp'), or any website URL (https://example.com). Auto-discovers changelog paths."
      ),
      max_length: z.number().optional().default(6000).describe("Max content length"),
    }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ url, max_length }) => {
    try {
      const result = await changelogAdapter({ url, maxLength: max_length });
      const ctx = stampFreshness(result, { url, maxLength: max_length }, "changelog");
      return { content: [{ type: "text", text: formatForLLM(ctx) }] };
    } catch (err) {
      return { content: [{ type: "text", text: formatSecurityError(err) }] };
    }
  }
);

// ─── Tool: extract_govcontracts ────────────────────────────────────────────
server.registerTool(
  "extract_govcontracts",
  {
    description:
      "Fetch US federal government contract awards from USASpending.gov. No API key required. Search by company name (e.g. 'Palantir'), keyword (e.g. 'AI infrastructure'), or NAICS code (e.g. '541511'). Returns award amounts, dates, awarding agency, NAICS code, and contract descriptions — all timestamped. Use this to find buying intent signals (a company that just won a $5M DoD contract is actively hiring and spending), competitive intelligence, or GTM targeting.",
    inputSchema: z.object({
      url: z.string().describe(
        "Company name (e.g. 'Cloudflare'), keyword (e.g. 'machine learning'), NAICS code (e.g. '541511'), or direct USASpending API URL."
      ),
      max_length: z.number().optional().default(6000).describe("Max content length"),
    }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ url, max_length }) => {
    try {
      const result = await govContractsAdapter({ url, maxLength: max_length });
      const ctx = stampFreshness(result, { url, maxLength: max_length }, "govcontracts");
      return { content: [{ type: "text", text: formatForLLM(ctx) }] };
    } catch (err) {
      return { content: [{ type: "text", text: formatSecurityError(err) }] };
    }
  }
);

// ─── Tool: extract_gov_landscape ───────────────────────────────────────────
// "Gov contracts for developers" — the full picture on any company or keyword
// in the US federal market. Contracts alone tell you who won money. This tool
// also tells you whether they're actually shipping, and whether the developer
// community knows they exist. Unique: no other MCP server has this.
server.registerTool(
  "extract_gov_landscape",
  {
    description:
      "Composite government intelligence tool. Given a company name, keyword, or NAICS code, simultaneously queries: (1) USASpending.gov for federal contract awards, (2) GitHub for the company's repo activity, (3) Hacker News for developer community awareness, and (4) their product changelog for release velocity. Answers: Who is winning government contracts in this space? Are they actually building? Does the dev community know about them? Returns a unified 4-source timestamped report. Unique — not available in any other MCP server.",
    inputSchema: z.object({
      query: z.string().describe(
        "Company name (e.g. 'Palantir'), keyword (e.g. 'artificial intelligence'), or NAICS code (e.g. '541511'). For GitHub and changelog sections, also optionally provide a GitHub URL."
      ),
      github_url: z.string().optional().describe(
        "Optional GitHub repo URL for the company (e.g. 'https://github.com/palantir/palantir-java-format'). If omitted, GitHub and changelog sections use the query as a search term."
      ),
      max_length: z.number().optional().default(12000),
      min_freshness_score: z.number().optional().describe("Filter sections below this freshness_score (0–100). E.g. 70 = only recently retrieved data."),
    }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ query, github_url, max_length, min_freshness_score }) => {
    const perSection = Math.floor((max_length ?? 12000) / 4);

    const [contractsResult, hnResult, repoResult, changelogResult] = await Promise.allSettled([
      govContractsAdapter({ url: query, maxLength: perSection }),
      hackerNewsAdapter({
        url: `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=10`,
        maxLength: perSection,
      }),
      repoSearchAdapter({ url: github_url ?? query, maxLength: perSection }),
      changelogAdapter({ url: github_url ?? query, maxLength: perSection }),
    ]);

    const combined = [
      `# Government Intelligence Landscape: "${query}"`,
      `Generated: ${new Date().toISOString()}`,
      `Sources: USASpending.gov · Hacker News · GitHub · Changelog`,
      min_freshness_score ? `min_freshness_score: ${min_freshness_score}` : null,
      "",
      sectionWithFreshnessCheck("🏛️ Federal Contract Awards (USASpending.gov)", contractsResult, "govcontracts", min_freshness_score),
      sectionWithFreshnessCheck("💬 Developer Community Awareness (Hacker News)", hnResult, "hackernews", min_freshness_score),
      sectionWithFreshnessCheck("📦 GitHub Repository Activity", repoResult, "reposearch", min_freshness_score),
      sectionWithFreshnessCheck("🔄 Product Release Velocity (Changelog)", changelogResult, "changelog", min_freshness_score),
    ].filter(Boolean).join("\n\n");

    return { content: [{ type: "text", text: combined }] };
  }
);

// ─── Tool: extract_finance_landscape ─────────────────────────────────────────
// "Finance for developers" — a stock price is a lagging indicator. This tool
// combines price data with the signals only developers can read: GitHub activity,
// community sentiment, repo ecosystem size, and product release velocity.
// Unique: Bloomberg Terminal doesn't read commit history as a company health signal.
server.registerTool(
  "extract_finance_landscape",
  {
    description:
      "Composite financial intelligence tool for developers. Given one or more ticker symbols, simultaneously queries: (1) Stooq for no-key quote data, (2) Hacker News for developer community sentiment, (3) Reddit for investor and tech community discussion, (4) GitHub for repo ecosystem activity around the company's tech, and (5) their product changelog for release velocity as a company health signal. Answers: What's the price? What are developers saying? Is the company actually shipping? Returns a unified 5-source timestamped report.",
    inputSchema: z.object({
      tickers: z.string().describe(
        "One or more ticker symbols e.g. 'PLTR' or 'PLTR,MSFT,GOOG'. Up to 5 tickers."
      ),
      company_name: z.string().optional().describe(
        "Company name for HN/Reddit/GitHub searches e.g. 'Palantir'. If omitted, derived from the ticker."
      ),
      github_query: z.string().optional().describe(
        "GitHub search query or repo URL for the company's tech ecosystem e.g. 'palantir' or 'https://github.com/palantir/foundry'. If omitted, uses company_name."
      ),
      max_length: z.number().optional().default(12000),
      min_freshness_score: z.number().optional().describe("Filter sections below this freshness_score (0–100). E.g. 70 = only recently retrieved data."),
    }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ tickers, company_name, github_query, max_length, min_freshness_score }) => {
    const perSection = Math.floor((max_length ?? 12000) / 5);
    const searchTerm = company_name ?? tickers.split(",")[0].trim();
    const repoQuery = github_query ?? searchTerm;

    const [priceResult, hnResult, redditResult, repoResult, changelogResult] = await Promise.allSettled([
      financeAdapter({ url: tickers, maxLength: perSection }),
      hackerNewsAdapter({
        url: `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(searchTerm)}&tags=story&hitsPerPage=10`,
        maxLength: perSection,
      }),
      redditAdapter({ url: `https://www.reddit.com/search.json?q=${encodeURIComponent(searchTerm)}&sort=new&limit=15`, maxLength: perSection }),
      repoSearchAdapter({ url: repoQuery, maxLength: perSection }),
      changelogAdapter({ url: repoQuery, maxLength: perSection }),
    ]);

    const combined = [
      `# Finance + Developer Intelligence: "${tickers}"${company_name ? ` (${company_name})` : ""}`,
      `Generated: ${new Date().toISOString()}`,
      `Sources: Stooq · Hacker News · Reddit · GitHub · Changelog`,
      min_freshness_score ? `min_freshness_score: ${min_freshness_score}` : null,
      "",
      sectionWithFreshnessCheck("📈 Market Data (Stooq)", priceResult, "finance", min_freshness_score),
      sectionWithFreshnessCheck("💬 Developer Sentiment (Hacker News)", hnResult, "hackernews", min_freshness_score),
      sectionWithFreshnessCheck("🗣️ Community Discussion (Reddit)", redditResult, "reddit", min_freshness_score),
      sectionWithFreshnessCheck("📦 Repo Ecosystem (GitHub)", repoResult, "reposearch", min_freshness_score),
      sectionWithFreshnessCheck("🔄 Product Release Velocity (Changelog)", changelogResult, "changelog", min_freshness_score),
    ].filter(Boolean).join("\n\n");

    return { content: [{ type: "text", text: combined }] };
  }
);

// ─── Tool: extract_sec_filings ─────────────────────────────────────────────
// 8-K filings = legally mandated material event disclosures. CEO changes,
// acquisitions, breaches, major contracts, regulatory actions — all filed
// within 4 business days. Most reliable early-warning corporate signal in existence.
// Unique: no other MCP server has this.
server.registerTool(
  "extract_sec_filings",
  {
    description:
      "Fetch SEC 8-K filings for any public company from the SEC EDGAR full-text search API. 8-K filings are legally mandated disclosures of material corporate events — CEO changes, acquisitions, data breaches, major contracts, regulatory actions — filed within 4 business days. Free, no auth, real-time. Pass a company name, ticker, or keyword. Unique: not available in any other MCP server.",
    inputSchema: z.object({
      url: z.string().describe("Company name, ticker, or keyword e.g. 'Palantir', 'PLTR', 'artificial intelligence'"),
      max_length: z.number().optional().default(6000),
    }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ url, max_length }) => {
    try {
      const result = await secFilingsAdapter({ url, maxLength: max_length });
      const ctx = stampFreshness(result, { url, maxLength: max_length }, "sec_filings");
      return { content: [{ type: "text", text: formatForLLM(ctx) }] };
    } catch (err) {
      return { content: [{ type: "text", text: formatSecurityError(err) }] };
    }
  }
);

// ─── Tool: extract_gdelt ─────────────────────────────────────────────────────
// GDELT monitors news from every country in 100+ languages, updated every 15 min.
// Returns structured global news intelligence — not just headlines but event
// codes, actor tags, tone scores, goldstein scale (impact), location, timestamp.
// Unique: no other MCP server has this.
server.registerTool(
  "extract_gdelt",
  {
    description:
      "Fetch global news intelligence from the GDELT Project. GDELT monitors broadcast, print, and web news from every country in 100+ languages, updated every 15 minutes. Returns articles with title, source domain, country of origin, language, and publication date — covering news worldwide that Western sources miss. Free, no auth. Pass any company name, topic, or keyword. Unique: not available in any other MCP server.",
    inputSchema: z.object({
      url: z.string().describe("Query: company name, topic, or keyword e.g. 'Palantir', 'artificial intelligence', 'MCP server'"),
      max_length: z.number().optional().default(6000),
    }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ url, max_length }) => {
    try {
      const result = await gdeltAdapter({ url, maxLength: max_length });
      const ctx = stampFreshness(result, { url, maxLength: max_length }, "gdelt");
      return { content: [{ type: "text", text: formatForLLM(ctx) }] };
    } catch (err) {
      return { content: [{ type: "text", text: formatSecurityError(err) }] };
    }
  }
);

// ─── Tool: extract_company_landscape ─────────────────────────────────────────
// The most complete single-call company intelligence available in any MCP server.
// 5 moat sources: SEC 8-K legal disclosures + federal contract footprint +
// global news intelligence + product release velocity + market pricing.
// Unique: this combination exists nowhere else.
server.registerTool(
  "extract_company_landscape",
  {
    description:
      "Composite company intelligence tool. The most complete single-call company analysis available. Simultaneously queries 5 unique sources: (1) SEC EDGAR for 8-K material event filings — what the company legally just disclosed, (2) USASpending.gov for federal contract footprint — who is giving them government money, (3) GDELT for global news intelligence — what the world is saying about them right now, (4) their product changelog — are they actually shipping, (5) Stooq quote data — what the market is pricing in. Returns a unified 5-source timestamped report. Unique: this combination is not available in any other MCP server.",
    inputSchema: z.object({
      company: z.string().describe(
        "Company name e.g. 'Palantir', 'Anthropic', 'OpenAI'"
      ),
      ticker: z.string().optional().describe(
        "Stock ticker for finance data e.g. 'PLTR'. Leave blank for private companies."
      ),
      github_url: z.string().optional().describe(
        "Optional GitHub repo or org URL e.g. 'https://github.com/palantir'. Improves changelog accuracy."
      ),
      max_length: z.number().optional().default(15000),
      min_freshness_score: z.number().optional().describe("Filter sections below this freshness_score (0–100). E.g. 70 = only recently retrieved data."),
    }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ company, ticker, github_url, max_length, min_freshness_score }) => {
    const perSection = Math.floor((max_length ?? 15000) / 5);
    const repoQuery = github_url ?? company;

    const [secResult, contractsResult, gdeltResult, changelogResult, financeResult] = await Promise.allSettled([
      secFilingsAdapter({ url: company, maxLength: perSection }),
      govContractsAdapter({ url: company, maxLength: perSection }),
      gdeltAdapter({ url: company, maxLength: perSection }),
      changelogAdapter({ url: repoQuery, maxLength: perSection }),
      financeAdapter({ url: ticker ?? company, maxLength: perSection }),
    ]);

    const combined = [
      `# Company Intelligence Landscape: "${company}"${ticker ? ` (${ticker})` : ""}`,
      `Generated: ${new Date().toISOString()}`,
      `Sources: SEC EDGAR · USASpending.gov · GDELT · Changelog · Stooq`,
      min_freshness_score ? `min_freshness_score: ${min_freshness_score}` : null,
      "",
      sectionWithFreshnessCheck("📋 SEC 8-K Filings — Legal Disclosures", secResult, "sec_filings", min_freshness_score),
      sectionWithFreshnessCheck("🏛️ Federal Contract Awards (USASpending.gov)", contractsResult, "govcontracts", min_freshness_score),
      sectionWithFreshnessCheck("🌍 Global News Intelligence (GDELT)", gdeltResult, "gdelt", min_freshness_score),
      sectionWithFreshnessCheck("🔄 Product Release Velocity (Changelog)", changelogResult, "changelog", min_freshness_score),
      sectionWithFreshnessCheck("📈 Market Data (Stooq)", financeResult, "finance", min_freshness_score),
    ].filter(Boolean).join("\n\n");

    return { content: [{ type: "text", text: combined }] };
  }
);

// ─── Tool: extract_gebiz ────────────────────────────────────────────────────
// Singapore Government procurement tenders via data.gov.sg open API.
// Ministry of Finance official dataset — all open tenders since FY2020.
// Free, no auth, structured. Unique: no other MCP server has this.
server.registerTool(
  "extract_gebiz",
  {
    description:
      "Fetch Singapore Government procurement opportunities from GeBIZ via the data.gov.sg open API (Ministry of Finance official dataset). Returns open tenders, awarded contracts, agencies, amounts, and closing dates. Search by keyword (e.g. 'software', 'AI', 'data analytics'), agency name (e.g. 'GovTech', 'MOH'), or leave blank for all recent tenders. Free, no auth. Unique: not available in any other MCP server.",
    inputSchema: z.object({
      url: z.string().describe(
        "Search keyword, agency name, or leave empty for all recent tenders. E.g. 'artificial intelligence', 'GovTech', 'cybersecurity'"
      ),
      max_length: z.number().optional().default(6000),
    }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ url, max_length }) => {
    try {
      const result = await gebizAdapter({ url, maxLength: max_length });
      const ctx = stampFreshness(result, { url, maxLength: max_length }, "gebiz");
      return { content: [{ type: "text", text: formatForLLM(ctx) }] };
    } catch (err) {
      return { content: [{ type: "text", text: formatSecurityError(err) }] };
    }
  }
);

// ─── Tool: extract_idea_landscape ───────────────────────────────────────────
// Idea validation composite — 6 sources that answer: should I build this?
// HN pain points + YC funded competitors + GitHub crowding + job market signal
// + package ecosystem adoption + Product Hunt recent launches.
// The job market section is the key differentiator — companies paying salaries
// around a problem is the strongest signal a real market exists.
server.registerTool(
  "extract_idea_landscape",
  {
    description:
      "Idea validation composite tool for developers and founders. Given a project idea or keyword, simultaneously queries 6 sources to answer: Is this problem real? Is the market crowded? Is there funding? Are companies hiring? What just launched? Sources: (1) Hacker News — what developers are actively complaining about and discussing, (2) YC companies — who has already received funding in this space, (3) GitHub repos — how crowded the open source landscape is, (4) Job listings — hiring signal showing real company spend around this problem, (5) npm/PyPI package trends — ecosystem adoption and velocity, (6) Product Hunt — what just launched and how it was received. Returns a unified 6-source idea validation report.",
    inputSchema: z.object({
      idea: z.string().describe(
        "Your idea, problem space, or keyword. E.g. 'data freshness for AI agents', 'procurement intelligence', 'developer observability'"
      ),
      max_length: z.number().optional().default(14000),
      min_freshness_score: z.number().optional().describe("Filter sections below this freshness_score (0–100). E.g. 70 = only recently retrieved data."),
    }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ idea, max_length, min_freshness_score }) => {
    const perSection = Math.floor((max_length ?? 14000) / 6);

    const [hnResult, ycResult, repoResult, jobsResult, pkgResult, phResult] = await Promise.allSettled([
      hackerNewsAdapter({
        url: `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(idea)}&tags=story&hitsPerPage=10`,
        maxLength: perSection,
      }),
      ycAdapter({
        url: `https://www.ycombinator.com/companies?query=${encodeURIComponent(idea)}`,
        maxLength: perSection,
      }),
      repoSearchAdapter({ url: idea, maxLength: perSection }),
      jobsAdapter({ url: idea, maxLength: perSection }),
      packageTrendsAdapter({ url: idea, maxLength: perSection }),
      productHuntAdapter({ url: idea, maxLength: perSection }),
    ]);

    const combined = [
      `# Idea Validation Landscape: "${idea}"`,
      `Generated: ${new Date().toISOString()}`,
      `Sources: Hacker News · YC Companies · GitHub · Job Listings · npm/PyPI · Product Hunt`,
      min_freshness_score ? `min_freshness_score: ${min_freshness_score}` : null,
      "",
      `## ℹ️ How to read this report`,
      `Pain signal (HN): Are developers actively discussing this problem?`,
      `Funding signal (YC): Has this already attracted institutional money?`,
      `Crowding signal (GitHub): How many repos exist — empty = opportunity, crowded = validation.`,
      `Market signal (Jobs): Companies hiring around this = real budget allocated = real market.`,
      `Ecosystem signal (npm/PyPI): Are packages being built and adopted?`,
      `Launch signal (Product Hunt): What just shipped — community reception and timing.`,
      "",
      sectionWithFreshnessCheck("🗣️ Pain Signal — Developer Discussions (Hacker News)", hnResult, "hackernews", min_freshness_score),
      sectionWithFreshnessCheck("💰 Funding Signal — Backed Companies (YC)", ycResult, "yc", min_freshness_score),
      sectionWithFreshnessCheck("📦 Crowding Signal — Open Source Landscape (GitHub)", repoResult, "reposearch", min_freshness_score),
      sectionWithFreshnessCheck("💼 Market Signal — Hiring Activity (Job Listings)", jobsResult, "jobs", min_freshness_score),
      sectionWithFreshnessCheck("🔧 Ecosystem Signal — Package Adoption (npm/PyPI)", pkgResult, "packagetrends", min_freshness_score),
      sectionWithFreshnessCheck("🚀 Launch Signal — Recent Launches (Product Hunt)", phResult, "producthunt", min_freshness_score),
    ].filter(Boolean).join("\n\n");

    return { content: [{ type: "text", text: combined }] };
  }
);

// ─── Start ───────────────────────────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("freshcontext-mcp running on stdio");
}

main().catch(console.error);

