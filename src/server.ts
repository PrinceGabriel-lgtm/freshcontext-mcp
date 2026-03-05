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
import { stampFreshness, formatForLLM } from "./tools/freshnessStamp.js";
import { SecurityError, formatSecurityError } from "./security.js";

const server = new McpServer({
  name: "freshcontext-mcp",
  version: "0.1.0",
});

// ─── Tool: extract_github ────────────────────────────────────────────────────
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
      "Extract top stories or search results from Hacker News. Real-time dev/tech community sentiment with post timestamps.",
    inputSchema: z.object({
      url: z.string().url().describe("HN URL e.g. https://news.ycombinator.com or https://hn.algolia.com/?q=..."),
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
      const ctx = stampFreshness(result, { url, maxLength: max_length }, "ycombinator");
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
      const ctx = stampFreshness(result, { url: query, maxLength: max_length }, "github_search");
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
      const ctx = stampFreshness(result, { url: packages, maxLength: max_length }, "package_registry");
      return { content: [{ type: "text", text: formatForLLM(ctx) }] };
    } catch (err) {
      return { content: [{ type: "text", text: formatSecurityError(err) }] };
    }
  }
);

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
      "Search for real-time job listings with publication dates on every result — so you never apply to a role that closed 2 years ago. Sources: Remotive (remote jobs) + HN 'Who is Hiring' (community). Returns timestamped freshcontext.",
    inputSchema: z.object({
      query: z.string().describe("Job search query e.g. 'typescript remote', 'senior python', 'mcp developer'"),
      max_length: z.number().optional().default(6000).describe("Max content length"),
    }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ query, max_length }) => {
    try {
      const result = await jobsAdapter({ url: query, maxLength: max_length });
      const ctx = stampFreshness(result, { url: query, maxLength: max_length }, "jobs");
      return { content: [{ type: "text", text: formatForLLM(ctx) }] };
    } catch (err) {
      return { content: [{ type: "text", text: formatSecurityError(err) }] };
    }
  }
);

// ─── Start ───────────────────────────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("freshcontext-mcp running on stdio");
}

main().catch(console.error);






