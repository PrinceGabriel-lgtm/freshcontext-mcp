import puppeteer from "@cloudflare/puppeteer";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";

// ─── Types ───────────────────────────────────────────────────────────────────

interface Env {
  BROWSER: Fetcher;
}

interface FreshContext {
  content: string;
  source_url: string;
  content_date: string | null;
  retrieved_at: string;
  freshness_confidence: "high" | "medium" | "low";
  adapter: string;
}

// ─── Freshness Stamp ─────────────────────────────────────────────────────────

function stamp(content: string, url: string, date: string | null, confidence: "high" | "medium" | "low", adapter: string): string {
  const ctx: FreshContext = {
    content: content.slice(0, 6000),
    source_url: url,
    content_date: date,
    retrieved_at: new Date().toISOString(),
    freshness_confidence: confidence,
    adapter,
  };
  return [
    "[FRESHCONTEXT]",
    `Source: ${ctx.source_url}`,
    `Published: ${ctx.content_date ?? "unknown"}`,
    `Retrieved: ${ctx.retrieved_at}`,
    `Confidence: ${ctx.freshness_confidence}`,
    "---",
    ctx.content,
    "[/FRESHCONTEXT]",
  ].join("\n");
}

// ─── Server Factory ───────────────────────────────────────────────────────────

function createServer(env: Env): McpServer {
  const server = new McpServer({ name: "freshcontext-mcp", version: "0.1.0" });

  // ── extract_github ──────────────────────────────────────────────────────────
  server.registerTool("extract_github", {
    description: "Extract real-time data from a GitHub repository — README, stars, forks, last commit, topics. Returns timestamped freshcontext.",
    inputSchema: z.object({
      url: z.string().url().describe("Full GitHub repo URL"),
    }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ url }) => {
    const browser = await puppeteer.launch(env.BROWSER);
    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36");
    await page.goto(url, { waitUntil: "domcontentloaded" });

    const data = await page.evaluate(`(function() {
      var readme = (document.querySelector('[data-target="readme-toc.content"]') || document.querySelector('.markdown-body') || {}).textContent || null;
      var starsEl = document.querySelector('[id="repo-stars-counter-star"]') || document.querySelector('.Counter.js-social-count');
      var stars = starsEl ? starsEl.textContent.trim() : null;
      var forksEl = document.querySelector('[id="repo-network-counter"]');
      var forks = forksEl ? forksEl.textContent.trim() : null;
      var commitEl = document.querySelector('relative-time');
      var lastCommit = commitEl ? commitEl.getAttribute('datetime') : null;
      var descEl = document.querySelector('.f4.my-3');
      var description = descEl ? descEl.textContent.trim() : null;
      var topics = Array.from(document.querySelectorAll('.topic-tag')).map(function(t) { return t.textContent.trim(); });
      var langEl = document.querySelector('.color-fg-default.text-bold.mr-1');
      var language = langEl ? langEl.textContent.trim() : null;
      return { readme, stars, forks, lastCommit, description, topics, language };
    })()`);

    await browser.close();
    const d = data as any;
    const raw = [`Description: ${d.description ?? "N/A"}`, `Stars: ${d.stars ?? "N/A"} | Forks: ${d.forks ?? "N/A"}`, `Language: ${d.language ?? "N/A"}`, `Last commit: ${d.lastCommit ?? "N/A"}`, `Topics: ${d.topics?.join(", ") ?? "none"}`, `\n--- README ---\n${d.readme ?? "No README"}`].join("\n");
    return { content: [{ type: "text", text: stamp(raw, url, d.lastCommit ?? null, d.lastCommit ? "high" : "medium", "github") }] };
  });

  // ── extract_hackernews ──────────────────────────────────────────────────────
  server.registerTool("extract_hackernews", {
    description: "Extract top stories from Hacker News with real-time timestamps.",
    inputSchema: z.object({ url: z.string().url().describe("HN URL") }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ url }) => {
    const browser = await puppeteer.launch(env.BROWSER);
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded" });

    const data = await page.evaluate(`(function() {
      var items = Array.from(document.querySelectorAll('.athing')).slice(0, 20);
      return items.map(function(el) {
        var titleLineEl = el.querySelector('.titleline > a');
        var title = titleLineEl ? titleLineEl.textContent.trim() : null;
        var link = titleLineEl ? titleLineEl.getAttribute('href') : null;
        var subtext = el.nextElementSibling;
        var scoreEl = subtext ? subtext.querySelector('.score') : null;
        var score = scoreEl ? scoreEl.textContent.trim() : null;
        var ageEl = subtext ? subtext.querySelector('.age') : null;
        var age = ageEl ? ageEl.getAttribute('title') : null;
        return { title, link, score, age };
      });
    })()`);

    await browser.close();
    const items = data as any[];
    const raw = items.map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.link}\nScore: ${r.score ?? "N/A"}\nPosted: ${r.age ?? "unknown"}`).join("\n\n");
    const newest = items.map(r => r.age).filter(Boolean).sort().reverse()[0] ?? null;
    return { content: [{ type: "text", text: stamp(raw, url, newest, newest ? "high" : "medium", "hackernews") }] };
  });

  // ── extract_scholar ─────────────────────────────────────────────────────────
  server.registerTool("extract_scholar", {
    description: "Extract research results from Google Scholar with publication dates.",
    inputSchema: z.object({ url: z.string().url().describe("Google Scholar URL") }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ url }) => {
    const browser = await puppeteer.launch(env.BROWSER);
    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36");
    await page.goto(url, { waitUntil: "domcontentloaded" });

    const data = await page.evaluate(`(function() {
      var items = Array.from(document.querySelectorAll('.gs_r.gs_or.gs_scl'));
      return items.map(function(el) {
        var titleEl = el.querySelector('.gs_rt');
        var title = titleEl ? titleEl.textContent.trim() : null;
        var authorsEl = el.querySelector('.gs_a');
        var authors = authorsEl ? authorsEl.textContent.trim() : null;
        var snippetEl = el.querySelector('.gs_rs');
        var snippet = snippetEl ? snippetEl.textContent.trim() : null;
        var yearMatch = authors ? authors.match(/\\b(19|20)\\d{2}\\b/) : null;
        var year = yearMatch ? yearMatch[0] : null;
        return { title, authors, snippet, year };
      });
    })()`);

    await browser.close();
    const items = data as any[];
    const raw = items.map((r, i) => `[${i + 1}] ${r.title ?? "Untitled"}\nAuthors: ${r.authors ?? "Unknown"}\nYear: ${r.year ?? "Unknown"}\nSnippet: ${r.snippet ?? "N/A"}`).join("\n\n");
    const years = items.map(r => r.year).filter(Boolean).sort().reverse();
    const newest = years[0] ?? null;
    return { content: [{ type: "text", text: stamp(raw, url, newest ? `${newest}-01-01` : null, newest ? "high" : "low", "google_scholar") }] };
  });

  return server;
}

// ─── Worker Export ────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const transport = new WebStandardStreamableHTTPServerTransport();
    const server = createServer(env);
    await server.connect(transport);
    return transport.handleRequest(request);
  },
} satisfies ExportedHandler<Env>;
