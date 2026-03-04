import puppeteer from "@cloudflare/puppeteer";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Env {
  BROWSER: Fetcher;
  API_KEY?: string; // Optional: set via `wrangler secret put API_KEY`
}

interface FreshContext {
  content: string;
  source_url: string;
  content_date: string | null;
  retrieved_at: string;
  freshness_confidence: "high" | "medium" | "low";
  adapter: string;
}

// ─── Security ─────────────────────────────────────────────────────────────────

const ALLOWED_DOMAINS: Record<string, string[]> = {
  github:      ["github.com", "raw.githubusercontent.com"],
  scholar:     ["scholar.google.com"],
  hackernews:  ["news.ycombinator.com", "hn.algolia.com"],
  yc:          ["www.ycombinator.com", "ycombinator.com"],
};

const PRIVATE_IP_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
];

const MAX_URL_LENGTH    = 500;
const MAX_QUERY_LENGTH  = 200;

class SecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecurityError";
  }
}

function validateUrl(rawUrl: string, adapter: string): string {
  if (rawUrl.length > MAX_URL_LENGTH)
    throw new SecurityError(`URL too long (max ${MAX_URL_LENGTH} chars)`);

  let parsed: URL;
  try { parsed = new URL(rawUrl); }
  catch { throw new SecurityError("Invalid URL format"); }

  if (!["http:", "https:"].includes(parsed.protocol))
    throw new SecurityError("Only http/https URLs are allowed");

  const hostname = parsed.hostname.toLowerCase();

  for (const pattern of PRIVATE_IP_PATTERNS) {
    if (pattern.test(hostname))
      throw new SecurityError("Access to private/internal addresses is not allowed");
  }

  const allowed = ALLOWED_DOMAINS[adapter];
  if (allowed && allowed.length > 0) {
    const ok = allowed.some(d => hostname === d || hostname.endsWith(`.${d}`));
    if (!ok)
      throw new SecurityError(`URL not allowed for ${adapter}. Allowed domains: ${allowed.join(", ")}`);
  }

  return rawUrl;
}

function sanitizeQuery(query: string, maxLen = MAX_QUERY_LENGTH): string {
  if (query.length > maxLen)
    throw new SecurityError(`Query too long (max ${maxLen} chars)`);
  // Strip null bytes and control characters
  return query.replace(/[\x00-\x1F\x7F]/g, "").trim();
}

// ─── Rate Limiting (in-memory, per isolate) ───────────────────────────────────

interface RateEntry { count: number; windowStart: number; }
const rateMap = new Map<string, RateEntry>();

const RATE_LIMIT      = 20;   // max requests
const RATE_WINDOW_MS  = 60_000; // per 60 seconds

function checkRateLimit(ip: string): void {
  const now = Date.now();
  const entry = rateMap.get(ip);

  if (!entry || now - entry.windowStart > RATE_WINDOW_MS) {
    rateMap.set(ip, { count: 1, windowStart: now });
    return;
  }

  if (entry.count >= RATE_LIMIT) {
    throw new SecurityError(`Rate limit exceeded. Max ${RATE_LIMIT} requests per minute.`);
  }

  entry.count++;
}

// Prevent the map from growing unboundedly
function pruneRateMap(): void {
  const now = Date.now();
  for (const [ip, entry] of rateMap) {
    if (now - entry.windowStart > RATE_WINDOW_MS) rateMap.delete(ip);
  }
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

function checkAuth(request: Request, env: Env): void {
  if (!env.API_KEY) return; // Auth disabled if no key is set

  const authHeader = request.headers.get("Authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (token !== env.API_KEY) {
    throw new SecurityError("Unauthorized. Provide a valid Bearer token.");
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getClientIp(request: Request): string {
  return (
    request.headers.get("CF-Connecting-IP") ??
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ??
    "unknown"
  );
}

function securityErrorResponse(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ─── Freshness Stamp ──────────────────────────────────────────────────────────

function stamp(
  content: string,
  url: string,
  date: string | null,
  confidence: "high" | "medium" | "low",
  adapter: string
): string {
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
  const server = new McpServer({ name: "freshcontext-mcp", version: "0.1.3" });

  // ── extract_github ──────────────────────────────────────────────────────────
  server.registerTool("extract_github", {
    description: "Extract real-time data from a GitHub repository — README, stars, forks, last commit, topics. Returns timestamped freshcontext.",
    inputSchema: z.object({
      url: z.string().url().describe("Full GitHub repo URL e.g. https://github.com/owner/repo"),
    }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ url }) => {
    try {
      const safeUrl = validateUrl(url, "github");
      const browser = await puppeteer.launch(env.BROWSER);
      const page = await browser.newPage();
      await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36");
      await page.goto(safeUrl, { waitUntil: "domcontentloaded" });

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
      const raw = [
        `Description: ${d.description ?? "N/A"}`,
        `Stars: ${d.stars ?? "N/A"} | Forks: ${d.forks ?? "N/A"}`,
        `Language: ${d.language ?? "N/A"}`,
        `Last commit: ${d.lastCommit ?? "N/A"}`,
        `Topics: ${d.topics?.join(", ") ?? "none"}`,
        `\n--- README ---\n${d.readme ?? "No README"}`,
      ].join("\n");
      return { content: [{ type: "text", text: stamp(raw, safeUrl, d.lastCommit ?? null, d.lastCommit ? "high" : "medium", "github") }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `[ERROR] ${err.message}` }] };
    }
  });

  // ── extract_hackernews ──────────────────────────────────────────────────────
  server.registerTool("extract_hackernews", {
    description: "Extract top stories or search results from Hacker News with real-time timestamps.",
    inputSchema: z.object({ url: z.string().url().describe("HN URL e.g. https://news.ycombinator.com") }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ url }) => {
    try {
      const safeUrl = validateUrl(url, "hackernews");
      const browser = await puppeteer.launch(env.BROWSER);
      const page = await browser.newPage();
      await page.goto(safeUrl, { waitUntil: "domcontentloaded" });

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
      const raw = items.map((r, i) =>
        `[${i + 1}] ${r.title}\nURL: ${r.link}\nScore: ${r.score ?? "N/A"}\nPosted: ${r.age ?? "unknown"}`
      ).join("\n\n");
      const newest = items.map(r => r.age).filter(Boolean).sort().reverse()[0] ?? null;
      return { content: [{ type: "text", text: stamp(raw, safeUrl, newest, newest ? "high" : "medium", "hackernews") }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `[ERROR] ${err.message}` }] };
    }
  });

  // ── extract_scholar ─────────────────────────────────────────────────────────
  server.registerTool("extract_scholar", {
    description: "Extract research results from Google Scholar with publication dates.",
    inputSchema: z.object({ url: z.string().url().describe("Google Scholar search URL") }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ url }) => {
    try {
      const safeUrl = validateUrl(url, "scholar");
      const browser = await puppeteer.launch(env.BROWSER);
      const page = await browser.newPage();
      await page.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36");
      await page.goto(safeUrl, { waitUntil: "domcontentloaded" });

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
      const raw = items.map((r, i) =>
        `[${i + 1}] ${r.title ?? "Untitled"}\nAuthors: ${r.authors ?? "Unknown"}\nYear: ${r.year ?? "Unknown"}\nSnippet: ${r.snippet ?? "N/A"}`
      ).join("\n\n");
      const years = items.map(r => r.year).filter(Boolean).sort().reverse();
      const newest = years[0] ?? null;
      return { content: [{ type: "text", text: stamp(raw, safeUrl, newest ? `${newest}-01-01` : null, newest ? "high" : "low", "google_scholar") }] };
    } catch (err: any) {
      return { content: [{ type: "text", text: `[ERROR] ${err.message}` }] };
    }
  });

  return server;
}

// ─── Worker Export ────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Prune stale rate limit entries occasionally
    if (Math.random() < 0.05) pruneRateMap();

    try {
      // 1. Auth check
      checkAuth(request, env);

      // 2. Rate limit check
      const ip = getClientIp(request);
      checkRateLimit(ip);

    } catch (err: any) {
      const status = err.message.startsWith("Unauthorized") ? 401 : 429;
      return securityErrorResponse(err.message, status);
    }

    // 3. Handle MCP request
    const transport = new WebStandardStreamableHTTPServerTransport();
    const server = createServer(env);
    await server.connect(transport);
    return transport.handleRequest(request);
  },
} satisfies ExportedHandler<Env>;
