import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { githubAdapter } from "./adapters/github";
import { scholarAdapter } from "./adapters/scholar";
import { hackerNewsAdapter } from "./adapters/hackernews";
import { stampFreshness, formatForLLM } from "./tools/freshnessStamp";

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
    const result = await githubAdapter({ url, maxLength: max_length });
    const ctx = stampFreshness(result, { url, maxLength: max_length }, "github");
    return { content: [{ type: "text", text: formatForLLM(ctx) }] };
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
    const result = await scholarAdapter({ url, maxLength: max_length });
    const ctx = stampFreshness(result, { url, maxLength: max_length }, "google_scholar");
    return { content: [{ type: "text", text: formatForLLM(ctx) }] };
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
    const result = await hackerNewsAdapter({ url, maxLength: max_length });
    const ctx = stampFreshness(result, { url, maxLength: max_length }, "hackernews");
    return { content: [{ type: "text", text: formatForLLM(ctx) }] };
  }
);

// ─── Start ───────────────────────────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("freshcontext-mcp running on stdio");
}

main().catch(console.error);
