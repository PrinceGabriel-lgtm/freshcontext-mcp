import puppeteer from "@cloudflare/puppeteer";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { synthesizeBriefing as generateAIBriefing } from "./synthesize.js";
import { scoreSignal, parseStoredProfile, semanticFingerprint, isDuplicate } from "./intelligence.js";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Env {
  BROWSER: Fetcher;
  RATE_LIMITER: KVNamespace;
  CACHE: KVNamespace;
  DB: D1Database;
  API_KEY?: string;
  ANTHROPIC_KEY?: string;
  GITHUB_TOKEN?: string;
}

// ─── Cache Layer ──────────────────────────────────────────────────────────────

const CACHE_TTL: Record<string, number> = {
  jobs:          60 * 60 * 2,
  github:        60 * 30,
  hackernews:    60 * 15,
  scholar:       60 * 60 * 6,
  arxiv:         60 * 60 * 4,
  yc:            60 * 60 * 4,
  producthunt:   60 * 30,
  reddit:        60 * 20,
  finance:       60 * 5,
  reposearch:    60 * 30,
  packagetrends: 60 * 60 * 2,
};
const DEFAULT_TTL = 60 * 30;

function cacheKey(adapter: string, input: string): string {
  const normalized = input.trim().toLowerCase().slice(0, 200);
  return `cache:${adapter}:${normalized}`;
}

interface FreshContext {
  content: string;
  source_url: string;
  content_date: string | null;
  retrieved_at: string;
  freshness_confidence: "high" | "medium" | "low";
  adapter: string;
}

async function getFromCache(kv: KVNamespace, adapter: string, input: string): Promise<FreshContext | null> {
  try {
    const key = cacheKey(adapter, input);
    const raw = await kv.get(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FreshContext & { _cached_at: string };
    parsed.content = `[⚡ Cached — retrieved at ${parsed._cached_at}]\n\n` + parsed.content;
    return parsed;
  } catch { return null; }
}

async function setInCache(kv: KVNamespace, adapter: string, input: string, result: FreshContext): Promise<void> {
  try {
    const key = cacheKey(adapter, input);
    const ttl = CACHE_TTL[adapter.toLowerCase()] ?? DEFAULT_TTL;
    const payload = JSON.stringify({ ...result, _cached_at: new Date().toISOString() });
    await kv.put(key, payload, { expirationTtl: ttl });
  } catch { /* non-fatal */ }
}

// ─── Security ─────────────────────────────────────────────────────────────────

const ALLOWED_DOMAINS: Record<string, string[]> = {
  github:      ["github.com", "raw.githubusercontent.com"],
  scholar:     ["scholar.google.com"],
  hackernews:  ["news.ycombinator.com", "hn.algolia.com"],
  yc:          ["www.ycombinator.com", "ycombinator.com"],
  producthunt: ["www.producthunt.com", "producthunt.com"],
};

const PRIVATE_IP_PATTERNS = [
  /^localhost$/i, /^127\./, /^10\./, /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./, /^169\.254\./, /^::1$/, /^fc00:/i, /^fe80:/i,
];

class SecurityError extends Error {
  constructor(message: string) { super(message); this.name = "SecurityError"; }
}

function validateUrl(rawUrl: string, adapter: string): string {
  if (rawUrl.length > 500) throw new SecurityError("URL too long (max 500 chars)");
  let parsed: URL;
  try { parsed = new URL(rawUrl); } catch { throw new SecurityError("Invalid URL format"); }
  if (!["http:", "https:"].includes(parsed.protocol))
    throw new SecurityError("Only http/https URLs are allowed");
  const hostname = parsed.hostname.toLowerCase();
  for (const p of PRIVATE_IP_PATTERNS)
    if (p.test(hostname)) throw new SecurityError("Access to private addresses is not allowed");
  const allowed = ALLOWED_DOMAINS[adapter];
  if (allowed?.length) {
    if (!allowed.some(d => hostname === d || hostname.endsWith(`.${d}`)))
      throw new SecurityError(`Domain not allowed for ${adapter}: ${hostname}`);
  }
  return rawUrl;
}

// ─── Rate Limiting ────────────────────────────────────────────────────────────

const RATE_LIMIT    = 60;
const RATE_WINDOW_S = 60;

async function checkRateLimit(ip: string, kv: KVNamespace): Promise<void> {
  const key = `rl:${ip}`;
  const current = await kv.get(key);
  const count = current ? parseInt(current) : 0;
  if (count >= RATE_LIMIT)
    throw new SecurityError(`Rate limit exceeded — max ${RATE_LIMIT} requests per minute per IP.`);
  if (!current) {
    await kv.put(key, "1", { expirationTtl: RATE_WINDOW_S });
  } else {
    await kv.put(key, String(count + 1), { expirationTtl: RATE_WINDOW_S });
  }
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

function checkAuth(request: Request, env: Env): void {
  if (!env.API_KEY) return;
  const token = (request.headers.get("Authorization") ?? "").replace("Bearer ", "");
  if (token !== env.API_KEY) throw new SecurityError("Unauthorized");
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getClientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP")
    ?? request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim()
    ?? "unknown";
}

function errResponse(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status, headers: { "Content-Type": "application/json" },
  });
}

function stamp(
  content: string,
  url: string,
  date: string | null,
  confidence: "high" | "medium" | "low",
  adapter: string
): string {
  return [
    "[FRESHCONTEXT]",
    `Source: ${url}`,
    `Published: ${date ?? "unknown"}`,
    `Retrieved: ${new Date().toISOString()}`,
    `Confidence: ${confidence}`,
    "---",
    content.slice(0, 6000),
    "[/FRESHCONTEXT]",
  ].join("\n");
}

// ─── withCache helper ─────────────────────────────────────────────────────────

type ToolResult = { content: Array<{ type: "text"; text: string }> };

async function withCache(
  adapter: string,
  cacheInput: string,
  kv: KVNamespace,
  handler: () => Promise<ToolResult>
): Promise<ToolResult> {
  const cached = await getFromCache(kv, adapter, cacheInput);
  if (cached) return { content: [{ type: "text", text: cached.content }] };
  const result = await handler();
  const text = result.content[0]?.text ?? "";
  setInCache(kv, adapter, cacheInput, {
    content: text, source_url: cacheInput, content_date: null,
    retrieved_at: new Date().toISOString(), freshness_confidence: "medium", adapter,
  }).catch(() => {});
  return result;
}

// ─── MCP Server ───────────────────────────────────────────────────────────────

function createServer(env: Env): McpServer {
  const server = new McpServer({ name: "freshcontext-mcp", version: "0.3.15" });

  const ok = (text: string): ToolResult => ({ content: [{ type: "text", text }] });

  server.registerTool("extract_github", {
    description: "Extract real-time data from a GitHub repository — README, stars, forks, last commit, topics. Returns timestamped freshcontext.",
    inputSchema: z.object({ url: z.string().url().describe("Full GitHub repo URL e.g. https://github.com/owner/repo") }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ url }) => {
    return withCache("github", url, env.CACHE, async () => {
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
        const raw = [`Description: ${d.description ?? "N/A"}`, `Stars: ${d.stars ?? "N/A"} | Forks: ${d.forks ?? "N/A"}`, `Language: ${d.language ?? "N/A"}`, `Last commit: ${d.lastCommit ?? "N/A"}`, `Topics: ${d.topics?.join(", ") ?? "none"}`, `\n--- README ---\n${d.readme ?? "No README"}`].join("\n");
        return ok(stamp(raw, safeUrl, d.lastCommit ?? null, d.lastCommit ? "high" : "medium", "github"));
      } catch (err: any) { return ok(`[ERROR] ${err.message}`); }
    });
  });

  server.registerTool("extract_hackernews", {
    description: "Extract top stories or search results from Hacker News with real-time timestamps.",
    inputSchema: z.object({ url: z.string().url().describe("HN URL e.g. https://news.ycombinator.com or https://hn.algolia.com/?q=...") }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ url }) => {
    return withCache("hackernews", url, env.CACHE, async () => {
      try {
        if (url.includes("hn.algolia.com")) {
          const apiUrl = url.includes("/api/") ? url : `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(url)}&tags=story&hitsPerPage=20`;
          const res = await fetch(apiUrl);
          if (!res.ok) throw new Error(`HN API error: ${res.status}`);
          const json = await res.json() as any;
          const raw = json.hits.map((r: any, i: number) =>
            `[${i+1}] ${r.title}\nURL: ${r.url ?? `https://news.ycombinator.com/item?id=${r.objectID}`}\nScore: ${r.points} | ${r.num_comments} comments\nPosted: ${r.created_at}`
          ).join("\n\n");
          const newest = json.hits.map((r: any) => r.created_at).sort().reverse()[0] ?? null;
          return ok(stamp(raw, url, newest, newest ? "high" : "medium", "hackernews"));
        }
        const safeUrl = validateUrl(url, "hackernews");
        const browser = await puppeteer.launch(env.BROWSER);
        const page = await browser.newPage();
        await page.goto(safeUrl, { waitUntil: "domcontentloaded" });
        const data = await page.evaluate(`(function() {
          var items = Array.from(document.querySelectorAll('.athing')).slice(0, 20);
          return items.map(function(el) {
            var a = el.querySelector('.titleline > a');
            var sub = el.nextElementSibling;
            return { title: a?.textContent.trim(), link: a?.href, score: sub?.querySelector('.score')?.textContent.trim(), age: sub?.querySelector('.age')?.getAttribute('title') };
          });
        })()`);
        await browser.close();
        const items = data as any[];
        const raw = items.map((r, i) => `[${i+1}] ${r.title}\nURL: ${r.link}\nScore: ${r.score ?? "N/A"}\nPosted: ${r.age ?? "unknown"}`).join("\n\n");
        const newest2 = items.map(r => r.age).filter(Boolean).sort().reverse()[0] ?? null;
        return ok(stamp(raw, safeUrl, newest2, newest2 ? "high" : "medium", "hackernews"));
      } catch (err: any) { return ok(`[ERROR] ${err.message}`); }
    });
  });

  server.registerTool("extract_scholar", {
    description: "Extract research results from Google Scholar with publication dates.",
    inputSchema: z.object({ url: z.string().url().describe("Google Scholar search URL") }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ url }) => {
    return withCache("scholar", url, env.CACHE, async () => {
      try {
        const safeUrl = validateUrl(url, "scholar");
        const browser = await puppeteer.launch(env.BROWSER);
        const page = await browser.newPage();
        await page.setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36");
        await page.goto(safeUrl, { waitUntil: "domcontentloaded" });
        const data = await page.evaluate(`(function() {
          return Array.from(document.querySelectorAll('.gs_r.gs_or.gs_scl')).map(function(el) {
            var title = el.querySelector('.gs_rt')?.textContent.trim();
            var authors = el.querySelector('.gs_a')?.textContent.trim();
            var snippet = el.querySelector('.gs_rs')?.textContent.trim();
            var year = authors?.match(/\\b(19|20)\\d{2}\\b/)?.[0] ?? null;
            return { title, authors, snippet, year };
          });
        })()`);
        await browser.close();
        const items = data as any[];
        const raw = items.map((r, i) => `[${i+1}] ${r.title ?? "Untitled"}\nAuthors: ${r.authors ?? "Unknown"}\nYear: ${r.year ?? "Unknown"}\nSnippet: ${r.snippet ?? "N/A"}`).join("\n\n");
        const newest = items.map(r => r.year).filter(Boolean).sort().reverse()[0] ?? null;
        return ok(stamp(raw, safeUrl, newest ? `${newest}-01-01` : null, newest ? "high" : "low", "google_scholar"));
      } catch (err: any) { return ok(`[ERROR] ${err.message}`); }
    });
  });

  server.registerTool("extract_yc", {
    description: "Scrape YC company listings by keyword. Returns name, batch, tags, description per company.",
    inputSchema: z.object({ url: z.string().url().describe("YC URL e.g. https://www.ycombinator.com/companies?query=mcp") }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ url }) => {
    return withCache("yc", url, env.CACHE, async () => {
      try {
        const safeUrl = validateUrl(url, "yc");
        const browser = await puppeteer.launch(env.BROWSER);
        const page = await browser.newPage();
        await page.goto(safeUrl, { waitUntil: "networkidle0" });
        await new Promise(r => setTimeout(r, 1500));
        const data = await page.evaluate(`(function() {
          return Array.from(document.querySelectorAll('a._company_i9oky_355')).slice(0, 20).map(function(el) {
            var name = el.querySelector('._coName_i9oky_470')?.textContent.trim();
            var desc = el.querySelector('._coDescription_i9oky_478')?.textContent.trim();
            var batch = el.querySelector('._batch_i9oky_496')?.textContent.trim();
            var tags = Array.from(el.querySelectorAll('._pill_i9oky_33')).map(function(t) { return t.textContent.trim(); });
            return { name, desc, batch, tags };
          });
        })()`);
        await browser.close();
        const items = data as any[];
        const raw = items.map((c, i) => `[${i+1}] ${c.name ?? "Unknown"} (${c.batch ?? "N/A"})\n${c.desc ?? "No description"}\nTags: ${c.tags?.join(", ") ?? "none"}`).join("\n\n");
        return ok(stamp(raw, safeUrl, new Date().toISOString().slice(0, 10), "medium", "ycombinator"));
      } catch (err: any) { return ok(`[ERROR] ${err.message}`); }
    });
  });

  server.registerTool("search_repos", {
    description: "Search GitHub for repositories matching a keyword. Returns top results by stars.",
    inputSchema: z.object({ query: z.string().describe("Search query e.g. 'mcp server typescript'") }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ query }) => {
    return withCache("reposearch", query, env.CACHE, async () => {
      try {
        const q = query.replace(/[\x00-\x1F]/g, "").trim().slice(0, 200);
        const res = await fetch(`https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=15`, {
          headers: { "User-Agent": "freshcontext-mcp/0.3.15", "Accept": "application/vnd.github+json" },
        });
        if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
        const json = await res.json() as any;
        const raw = json.items.map((r: any, i: number) =>
          `[${i+1}] ${r.full_name}\n⭐ ${r.stargazers_count} stars | ${r.language ?? "N/A"}\n${r.description ?? "No description"}\nUpdated: ${r.updated_at?.slice(0,10)}\nURL: ${r.html_url}`
        ).join("\n\n");
        const newest = json.items.map((r: any) => r.updated_at).filter(Boolean).sort().reverse()[0] ?? null;
        return ok(stamp(raw, `https://github.com/search?q=${encodeURIComponent(q)}`, newest, newest ? "high" : "medium", "github_search"));
      } catch (err: any) { return ok(`[ERROR] ${err.message}`); }
    });
  });

  server.registerTool("package_trends", {
    description: "npm and PyPI package metadata — version history, release cadence, last updated.",
    inputSchema: z.object({ packages: z.string().describe("Package name(s) e.g. 'langchain' or 'npm:zod,pypi:fastapi'") }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ packages }) => {
    return withCache("packagetrends", packages, env.CACHE, async () => {
      try {
        const entries = packages.split(",").map(s => s.trim()).filter(Boolean).slice(0, 5);
        const results: string[] = [];
        for (const entry of entries) {
          const isNpm = !entry.startsWith("pypi:") && (entry.startsWith("npm:") || !entry.includes(":"));
          const name = entry.replace(/^(npm:|pypi:)/, "");
          if (isNpm) {
            const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`);
            if (!res.ok) { results.push(`[npm:${name}] Not found`); continue; }
            const j = await res.json() as any;
            const versions = Object.keys(j.versions ?? {}).slice(-5).reverse();
            results.push(`npm:${name}\nLatest: ${j["dist-tags"]?.latest ?? "N/A"}\nUpdated: ${j.time?.modified?.slice(0,10) ?? "N/A"}\nRecent versions: ${versions.join(", ")}\nDescription: ${j.description ?? "N/A"}`);
          } else {
            const res = await fetch(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`);
            if (!res.ok) { results.push(`[pypi:${name}] Not found`); continue; }
            const j = await res.json() as any;
            const versions = Object.keys(j.releases ?? {}).slice(-5).reverse();
            results.push(`pypi:${name}\nLatest: ${j.info?.version ?? "N/A"}\nDescription: ${j.info?.summary ?? "N/A"}\nRecent versions: ${versions.join(", ")}`);
          }
        }
        const raw = results.join("\n\n─────────────\n\n");
        return ok(stamp(raw, "package-registries", new Date().toISOString(), "high", "package_registry"));
      } catch (err: any) { return ok(`[ERROR] ${err.message}`); }
    });
  });

  server.registerTool("extract_reddit", {
    description: "Extract posts and community sentiment from Reddit.",
    inputSchema: z.object({ url: z.string().describe("Subreddit name e.g. 'r/MachineLearning' or search URL") }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ url }) => {
    return withCache("reddit", url, env.CACHE, async () => {
      try {
        let apiUrl = url;
        if (!apiUrl.startsWith("http")) {
          const clean = apiUrl.replace(/^r\//, "");
          apiUrl = `https://www.reddit.com/r/${clean}/.json?limit=25&sort=hot`;
        }
        if (!apiUrl.includes(".json")) apiUrl = apiUrl.replace(/\/?$/, ".json");
        if (!apiUrl.includes("limit=")) apiUrl += (apiUrl.includes("?") ? "&" : "?") + "limit=25";
        const res = await fetch(apiUrl, { headers: { "User-Agent": "freshcontext-mcp/0.3.15", "Accept": "application/json" } });
        if (!res.ok) throw new Error(`Reddit API error: ${res.status}`);
        const json = await res.json() as any;
        const posts = json?.data?.children ?? [];
        if (!posts.length) throw new Error("No posts found");
        const raw = posts.slice(0, 20).map((child: any, i: number) => {
          const p = child.data;
          const date = new Date(p.created_utc * 1000).toISOString();
          return [`[${i+1}] ${p.title}`, `r/${p.subreddit} · u/${p.author} · ${date.slice(0,10)}`, `↑ ${p.score} · ${p.num_comments} comments`, `https://reddit.com${p.permalink}`].join("\n");
        }).join("\n\n");
        const newest = posts.map((c: any) => c.data.created_utc).sort((a: number, b: number) => b - a)[0];
        const date = newest ? new Date(newest * 1000).toISOString() : null;
        return ok(stamp(raw, apiUrl, date, date ? "high" : "medium", "reddit"));
      } catch (err: any) { return ok(`[ERROR] ${err.message}`); }
    });
  });

  server.registerTool("extract_producthunt", {
    description: "Recent Product Hunt launches by keyword or topic.",
    inputSchema: z.object({ url: z.string().describe("Search query or PH topic URL") }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ url }) => {
    return withCache("producthunt", url, env.CACHE, async () => {
      try {
        const isUrl = url.startsWith("http");
        const gql = `{ posts(first: 20, order: VOTES${isUrl ? "" : `, search: ${JSON.stringify(url)}`}) { edges { node { name tagline url votesCount commentsCount createdAt topics { edges { node { name } } } } } } }`;
        const res = await fetch("https://api.producthunt.com/v2/api/graphql", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": "Bearer irgTzMNAz-S-p1P8H5pFCxzU4TEF7GIJZ8vZZi0gLJg" },
          body: JSON.stringify({ query: gql }),
        });
        const json = await res.json() as any;
        const posts = json?.data?.posts?.edges ?? [];
        if (!posts.length) throw new Error("No results found");
        const raw = posts.map((e: any, i: number) => {
          const p = e.node;
          const topics = p.topics?.edges?.map((t: any) => t.node.name).join(", ");
          return [`[${i+1}] ${p.name}`, `"${p.tagline}"`, `↑ ${p.votesCount} · ${p.commentsCount} comments`, topics ? `Topics: ${topics}` : null, `Launched: ${p.createdAt?.slice(0,10)}`, `Link: ${p.url}`].filter(Boolean).join("\n");
        }).join("\n\n");
        const newest = posts.map((e: any) => e.node.createdAt).filter(Boolean).sort().reverse()[0] ?? null;
        return ok(stamp(raw, url, newest, newest ? "high" : "medium", "producthunt"));
      } catch (err: any) { return ok(`[ERROR] ${err.message}`); }
    });
  });

  server.registerTool("extract_finance", {
    description: "Live stock data via Yahoo Finance. Accepts comma-separated ticker symbols.",
    inputSchema: z.object({ url: z.string().describe("Ticker symbol(s) e.g. 'AAPL' or 'MSFT,GOOG'") }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ url }) => {
    return withCache("finance", url, env.CACHE, async () => {
      try {
        const tickers = url.split(",").map(t => t.trim().toUpperCase()).filter(Boolean).slice(0, 5);
        const results: string[] = [];
        let latestTs: number | null = null;
        for (const ticker of tickers) {
          const res = await fetch(
            `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${ticker}&fields=shortName,longName,regularMarketPrice,regularMarketChange,regularMarketChangePercent,marketCap,regularMarketVolume,fiftyTwoWeekHigh,fiftyTwoWeekLow,trailingPE,dividendYield,currency,exchangeName,regularMarketTime`,
            { headers: { "User-Agent": "Mozilla/5.0 (compatible; freshcontext-mcp/0.3.15)" } }
          );
          if (!res.ok) { results.push(`[${ticker}] Error: ${res.status}`); continue; }
          const json = await res.json() as any;
          const q = json?.quoteResponse?.result?.[0];
          if (!q) { results.push(`[${ticker}] No data found`); continue; }
          if (q.regularMarketTime) latestTs = Math.max(latestTs ?? 0, q.regularMarketTime);
          const sign = (q.regularMarketChange ?? 0) >= 0 ? "+" : "";
          const cap = q.marketCap >= 1e12 ? `$${(q.marketCap/1e12).toFixed(2)}T` : q.marketCap >= 1e9 ? `$${(q.marketCap/1e9).toFixed(2)}B` : "N/A";
          results.push([`${q.symbol} — ${q.longName ?? q.shortName ?? "Unknown"}`, `Price: $${q.regularMarketPrice?.toFixed(2) ?? "N/A"}`, `Change: ${sign}${q.regularMarketChange?.toFixed(2) ?? "N/A"} (${sign}${q.regularMarketChangePercent?.toFixed(2) ?? "N/A"}%)`, `Market Cap: ${cap}`, `P/E: ${q.trailingPE?.toFixed(2) ?? "N/A"}`].join("\n"));
        }
        const raw = results.join("\n\n─────────────────────────────\n\n");
        const date = latestTs ? new Date(latestTs * 1000).toISOString() : new Date().toISOString();
        return ok(stamp(raw, `yahoo-finance:${tickers.join(",")}`, date, "high", "yahoo_finance"));
      } catch (err: any) { return ok(`[ERROR] ${err.message}`); }
    });
  });

  server.registerTool("search_jobs", {
    description: "Search for real-time job listings with freshness badges on every result. Sources: Remotive + HN Who is Hiring.",
    inputSchema: z.object({
      query: z.string().describe("Job search query e.g. 'typescript remote'"),
      max_length: z.number().optional().default(6000),
    }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ query, max_length }) => {
    return withCache("jobs", query, env.CACHE, async () => {
      try {
        const q = query.replace(/[\x00-\x1F]/g, "").trim().slice(0, 200);
        const perSource = Math.floor((max_length ?? 6000) / 2);
        const [remotiveRes, hnRes] = await Promise.allSettled([
          fetch(`https://remotive.com/api/remote-jobs?search=${encodeURIComponent(q)}&limit=10`, { headers: { "User-Agent": "freshcontext-mcp/0.3.15", "Accept": "application/json" } }).then(r => r.json()),
          fetch(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q + " hiring")}&tags=comment&hitsPerPage=8`).then(r => r.json()),
        ]);
        const sections: string[] = [`# Job Search: "${q}"`, `⚠️  Every listing below includes its publication date. Check it before you apply.`, ""];
        let newestDate: string | null = null;
        if (remotiveRes.status === "fulfilled") {
          const jobs = (remotiveRes.value as any).jobs ?? [];
          if (jobs.length) {
            const listings = jobs.slice(0, 10).map((job: any, i: number) => [`[${i+1}] ${job.title} — ${job.company_name}`, `Type: ${job.job_type || "N/A"} | Location: ${job.candidate_required_location || "Remote"}`, `Posted: ${job.publication_date}`, job.salary ? `Salary: ${job.salary}` : null, `Apply: ${job.url}`].filter(Boolean).join("\n")).join("\n\n").slice(0, perSource);
            sections.push(`## Remote Jobs (Remotive)\n${listings}`);
            const dates = jobs.map((j: any) => j.publication_date).filter(Boolean).sort().reverse();
            if (dates[0]) newestDate = dates[0] > (newestDate ?? "") ? dates[0] : newestDate;
          }
        }
        if (hnRes.status === "fulfilled") {
          const hits = ((hnRes.value as any).hits ?? []).filter((h: any) => { const t = (h.comment_text ?? "").toLowerCase(); return t.includes("hiring") || t.includes("remote") || t.includes("full-time"); });
          if (hits.length) {
            const listings = hits.slice(0, 6).map((hit: any, i: number) => { const text = (hit.comment_text ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300); return [`[${i+1}] Posted by ${hit.author} on ${hit.created_at?.slice(0, 10)}`, text + (text.length >= 300 ? "…" : ""), `Source: https://news.ycombinator.com/item?id=${hit.objectID}`].join("\n"); }).join("\n\n").slice(0, perSource);
            sections.push(`## HN "Who is Hiring"\n${listings}`);
          }
        }
        const raw = sections.join("\n\n");
        return ok(stamp(raw, `jobs:${q}`, newestDate ?? new Date().toISOString(), newestDate ? "high" : "medium", "jobs"));
      } catch (err: any) { return ok(`[ERROR] ${err.message}`); }
    });
  });

  server.registerTool("extract_landscape", {
    description: "Composite tool. Queries YC + GitHub + HN + npm simultaneously. Returns a unified timestamped landscape report.",
    inputSchema: z.object({ topic: z.string().describe("Project idea or keyword e.g. 'mcp server'") }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ topic }) => {
    return withCache("landscape", topic, env.CACHE, async () => {
      try {
        const t = topic.replace(/[\x00-\x1F]/g, "").trim().slice(0, 200);
        const [hn, repos, pkg] = await Promise.allSettled([
          fetch(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(t)}&tags=story&hitsPerPage=10`).then(r => r.json()),
          fetch(`https://api.github.com/search/repositories?q=${encodeURIComponent(t)}&sort=stars&per_page=8`, { headers: { "User-Agent": "freshcontext-mcp/0.3.15" } }).then(r => r.json()),
          fetch(`https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(t)}&size=5`).then(r => r.json()),
        ]);
        const sections = [
          `# Landscape Report: "${t}"`,
          `Generated: ${new Date().toISOString()}`,
          "",
          "## HN Sentiment",
          hn.status === "fulfilled" ? (hn.value as any).hits?.slice(0, 8).map((h: any, i: number) => `[${i+1}] ${h.title} (${h.points}pts, ${h.created_at?.slice(0,10)})`).join("\n") : `Error`,
          "",
          "## Top GitHub Repos",
          repos.status === "fulfilled" ? (repos.value as any).items?.slice(0, 8).map((r: any, i: number) => `[${i+1}] ${r.full_name} ⭐${r.stargazers_count} — ${r.description ?? "N/A"}`).join("\n") : `Error`,
          "",
          "## npm Packages",
          pkg.status === "fulfilled" ? (pkg.value as any).objects?.map((o: any, i: number) => `[${i+1}] ${o.package.name}@${o.package.version} — ${o.package.description ?? "N/A"}`).join("\n") : `Error`,
        ].join("\n");
        return ok(sections);
      } catch (err: any) { return ok(`[ERROR] ${err.message}`); }
    });
  });

  return server;
}

// ─── Cron Adapter Runner ──────────────────────────────────────────────────────

function sanitize(str: string): string {
  return str.replace(/[^\x00-\x7F]/g, "").replace(/\s+/g, " ").trim();
}

function simpleHash(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = Math.imul(31, h) + str.charCodeAt(i) | 0;
  return Math.abs(h).toString(36);
}

async function runAdapter(adapter: string, query: string, filters: Record<string, any>, env?: Env): Promise<string> {
  switch (adapter) {
    case "jobs": {
      const url = `https://remotive.com/api/remote-jobs?search=${encodeURIComponent(query)}&limit=10`;
      const res = await fetch(url, { headers: { "User-Agent": "freshcontext-mcp/cron", "Accept": "application/json" } });
      if (!res.ok) return `Remotive error ${res.status}`;
      const data = await res.json() as any;
      const location = filters.location ?? "";
      return sanitize((data.jobs ?? [])
        .filter((j: any) => !location || (j.candidate_required_location ?? "").toLowerCase().includes(location.toLowerCase()))
        .slice(0, 10)
        .map((j: any) => `${j.title} -- ${j.company_name} | ${j.candidate_required_location} | Posted: ${j.publication_date}`)
        .join("\n"));
    }
    case "hackernews": {
      const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=10`;
      const res = await fetch(url, { headers: { "User-Agent": "freshcontext-mcp/cron" } });
      const data = await res.json() as any;
      return sanitize(data.hits?.map((h: any) => `${h.title} | score:${h.points} | ${h.created_at}`).join("\n") ?? "");
    }
    case "reposearch": {
      const headers: Record<string, string> = { "User-Agent": "freshcontext-mcp/cron", "Accept": "application/vnd.github.v3+json" };
      if (env?.GITHUB_TOKEN) headers["Authorization"] = `Bearer ${env.GITHUB_TOKEN}`;
      const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&per_page=10`;
      const res = await fetch(url, { headers });
      const data = await res.json() as any;
      return sanitize(data.items?.map((r: any) => `${r.full_name} | stars:${r.stargazers_count} | updated:${r.updated_at?.slice(0,10)} | ${r.description ?? ""}`).join("\n") ?? "");
    }
    case "github": {
      const match = query.match(/github\.com\/([^/]+\/[^/]+)/);
      if (!match) return "";
      const repoSlug = match[1].replace(/\.git$/, "").split("/").slice(0, 2).join("/");
      const ghHeaders: Record<string, string> = { "User-Agent": "freshcontext-mcp/cron", "Accept": "application/vnd.github.v3+json" };
      if (env?.GITHUB_TOKEN) ghHeaders["Authorization"] = `Bearer ${env.GITHUB_TOKEN}`;
      const res = await fetch(`https://api.github.com/repos/${repoSlug}`, { headers: ghHeaders });
      if (!res.ok) return `GitHub error ${res.status} for ${repoSlug}`;
      const data = await res.json() as any;
      if (data.message) return sanitize(`GitHub: ${data.message}`);
      return sanitize(`Stars:${data.stargazers_count} Forks:${data.forks_count} Updated:${data.updated_at} Issues:${data.open_issues_count} Lang:${data.language ?? "N/A"} Description:${data.description ?? ""}`);
    }
    case "finance": {
      const symbol = query.replace(/[^A-Z0-9=^.-]/gi, "");
      const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbol}&fields=regularMarketPrice,regularMarketTime,shortName`;
      const res = await fetch(url, { headers: { "User-Agent": "freshcontext-mcp/cron" } });
      const data = await res.json() as any;
      const q = data.quoteResponse?.result?.[0];
      return q ? `${symbol}: $${q.regularMarketPrice} | ${q.shortName} | ${new Date(q.regularMarketTime * 1000).toISOString()}` : `No price data for ${symbol}`;
    }
    case "reddit": {
      const sub = query.match(/r\/(\w+)/)?.[1];
      const term = query.replace(/r\/\w+\s*/, "").trim();
      const url = sub && term
        ? `https://www.reddit.com/r/${sub}/search.json?q=${encodeURIComponent(term)}&sort=new&limit=10&restrict_sr=1`
        : sub
          ? `https://www.reddit.com/r/${sub}/new.json?limit=10`
          : `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&sort=new&limit=10`;
      const res = await fetch(url, { headers: { "User-Agent": "freshcontext-mcp/cron" } });
      if (!res.ok) return `Reddit error ${res.status}`;
      const data = await res.json() as any;
      return sanitize((data?.data?.children ?? []).map((p: any) =>
        `${p.data.title} | score:${p.data.score} | ${new Date(p.data.created_utc * 1000).toISOString()}`
      ).join("\n"));
    }
    case "yc": {
      const res = await fetch("https://yc-oss.github.io/api/companies/all.json", { headers: { "User-Agent": "freshcontext-mcp/cron" } });
      if (!res.ok) return `YC error ${res.status}`;
      const all = await res.json() as any[];
      const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
      const hits = all.filter((c: any) => {
        const text = `${c.name ?? ""} ${c.one_liner ?? ""} ${(c.tags ?? []).join(" ")}`.toLowerCase();
        return terms.some(t => text.includes(t));
      }).slice(0, 10);
      return hits.length
        ? sanitize(hits.map((h: any) => `${h.name} [${h.batch ?? "?"}] ${h.status ?? ""} -- ${h.one_liner ?? ""}`).join("\n"))
        : `No YC companies found for "${query}"`;
    }
    case "packagetrends": {
      const pkg = encodeURIComponent(query.trim());
      const [infoRes, dlRes] = await Promise.all([
        fetch(`https://registry.npmjs.org/${pkg}`, { headers: { "User-Agent": "freshcontext-mcp/cron" } }),
        fetch(`https://api.npmjs.org/downloads/point/last-month/${pkg}`, { headers: { "User-Agent": "freshcontext-mcp/cron" } }),
      ]);
      if (!infoRes.ok) return `npm error ${infoRes.status} for ${query}`;
      const info = await infoRes.json() as any;
      const dl = dlRes.ok ? await dlRes.json() as any : null;
      const latest = info["dist-tags"]?.latest ?? "?";
      const updated = info.time?.[latest] ?? info.time?.modified ?? "?";
      return `${query}@${latest} | downloads/month:${dl?.downloads ?? "?"} | last publish:${updated} | ${info.description ?? ""}`;
    }
    default:
      return `[adapter ${adapter} not implemented in cron]`;
  }
}

// ─── Scheduled Scrape with DAR Scoring ───────────────────────────────────────

async function runScheduledScrape(env: Env): Promise<void> {
  // ── Schema migrations (idempotent) ───────────────────────────────────────
  const migrations = [
    `ALTER TABLE scrape_results ADD COLUMN relevancy_score INTEGER DEFAULT 0`,
    `ALTER TABLE scrape_results ADD COLUMN is_relevant INTEGER DEFAULT 1`,
    `ALTER TABLE scrape_results ADD COLUMN base_score INTEGER DEFAULT 0`,
    `ALTER TABLE scrape_results ADD COLUMN rt_score REAL DEFAULT 0`,
    `ALTER TABLE scrape_results ADD COLUMN ha_pri_sig TEXT`,
    `ALTER TABLE scrape_results ADD COLUMN entropy_level TEXT DEFAULT 'stable'`,
    `ALTER TABLE scrape_results ADD COLUMN published_at TEXT`,
    `ALTER TABLE scrape_results ADD COLUMN semantic_fingerprint TEXT`,
  ];
  for (const sql of migrations) {
    try { await env.DB.prepare(sql).run(); } catch { /* column already exists */ }
  }

  // ── Load user profile for scoring ────────────────────────────────────────
  const profileRow = await env.DB.prepare(
    `SELECT id, name, skills, targets, location FROM user_profiles WHERE id = 'default' LIMIT 1`
  ).first<{ id: string; name: string | null; skills: string; targets: string; location: string | null }>();

  const profile = profileRow
    ? parseStoredProfile(profileRow)
    : {
        id: "default",
        name: "User",
        targets: ["typescript", "mcp", "developer", "remote", "ai tooling"],
        skills: ["typescript", "javascript", "cloudflare workers", "node.js", "python"],
        location: "remote",
      };

  // ── Load enabled watched queries ──────────────────────────────────────────
  const { results: queries } = await env.DB.prepare(
    `SELECT * FROM watched_queries WHERE enabled = 1 ORDER BY last_run_at ASC NULLS FIRST LIMIT 20`
  ).all<{ id: string; adapter: string; query: string; filters: string; user_id: string; label: string | null; last_run_at?: string }>();

  if (!queries.length) return;

  const adaptersRun: string[] = [];
  let newCount = 0;

  const scrapeOne = async (wq: typeof queries[0]) => {
    try {
      // Cooldown: skip if run within the last 60 minutes
      if (wq.last_run_at) {
        const age = Date.now() - new Date(wq.last_run_at + "Z").getTime();
        if (age < 60 * 60 * 1000) return null;
      }

      const filters = JSON.parse(wq.filters ?? "{}");
      const raw = await runAdapter(wq.adapter, wq.query, filters, env);
      if (!raw || raw.startsWith("[adapter")) return null;

      const hash = simpleHash(raw);
      const last = await env.DB.prepare(
        `SELECT result_hash FROM scrape_results WHERE watched_query_id = ? ORDER BY scraped_at DESC LIMIT 1`
      ).bind(wq.id).first<{ result_hash: string }>();

      // Skip if content unchanged (exact hash match)
      if (last && last.result_hash === hash) {
        await env.DB.prepare(`UPDATE watched_queries SET last_run_at = datetime('now') WHERE id = ?`).bind(wq.id).run();
        return null;
      }

      // Semantic deduplication — skip if same story already seen from another adapter
      const fingerprint = await semanticFingerprint(raw);
      if (await isDuplicate(env.DB, fingerprint, 48)) {
        console.log(`[dedup] ${wq.adapter}/${wq.query.slice(0,28)} — semantic duplicate, skipping`);
        await env.DB.prepare(`UPDATE watched_queries SET last_run_at = datetime('now') WHERE id = ?`).bind(wq.id).run();
        return null;
      }

      // Score with DAR engine
      const resultId = `sr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const exclusionTerms = filters.exclusion_terms ?? [];

      const scored = await scoreSignal({
        resultId,
        contentHash: hash,
        raw,
        adapter: wq.adapter,
        profile,
        exclusionTerms,
      });

      await env.DB.prepare(`
        INSERT INTO scrape_results
          (id, watched_query_id, adapter, query, raw_content, result_hash,
           is_new, scraped_at,
           relevancy_score, is_relevant,
           base_score, rt_score, ha_pri_sig, entropy_level, published_at,
           semantic_fingerprint)
        VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        resultId, wq.id, wq.adapter, wq.query, raw.slice(0, 8000), hash,
        scored.relevancy_score, scored.is_relevant,
        scored.base_score, scored.rt_score, scored.ha_pri_sig,
        scored.entropy_level, scored.published_at,
        fingerprint
      ).run();

      console.log(`[DAR] ${wq.adapter}/${wq.query.slice(0,28)} R0:${scored.base_score} Rt:${scored.rt_score} entropy:${scored.entropy_level} sig:${scored.ha_pri_sig.slice(0,8)}`);

      await env.DB.prepare(`UPDATE watched_queries SET last_run_at = datetime('now') WHERE id = ?`).bind(wq.id).run();

      // Only count as "new signal" if above the noise floor
      return scored.is_relevant === 1 ? wq.adapter : null;
    } catch (err: any) {
      console.error(`Scrape error [${wq.id}/${wq.adapter}]: ${err.message}`);
      return null;
    }
  };

  // Batches of 5 (Cloudflare subrequest limit)
  for (let i = 0; i < queries.length; i += 5) {
    const batch = queries.slice(i, i + 5);
    const batchResults = await Promise.allSettled(batch.map(scrapeOne));
    for (const r of batchResults) {
      if (r.status === "fulfilled" && r.value) {
        newCount++;
        if (!adaptersRun.includes(r.value)) adaptersRun.push(r.value);
      }
    }
  }

  if (newCount > 0) {
    const briefingId = `br_cron_${Date.now()}`;
    const summary = `Cron ${new Date().toISOString()}: ${newCount} new signals across ${adaptersRun.join(", ")}`;
    await env.DB.prepare(
      `INSERT INTO briefings (id, user_id, summary, new_results_count, adapters_run, created_at) VALUES (?, 'default', ?, ?, ?, datetime('now'))`
    ).bind(briefingId, summary, newCount, JSON.stringify(adaptersRun)).run();
  }
}

// ─── Fallback Briefing Formatter (no API needed) ──────────────────────────────
// Used when ANTHROPIC_KEY is not set. Formats D1 results into readable text.

async function formatBriefing(db: D1Database): Promise<string> {
  const { results: rows } = await db.prepare(`
    SELECT sr.adapter, sr.query, sr.raw_content, sr.scraped_at, wq.label,
           COALESCE(sr.rt_score, sr.relevancy_score, 50) as score
    FROM scrape_results sr
    JOIN watched_queries wq ON sr.watched_query_id = wq.id
    WHERE sr.is_new = 1
      AND (sr.is_relevant IS NULL OR sr.is_relevant = 1)
    ORDER BY score DESC, sr.scraped_at DESC
    LIMIT 20
  `).all<{ adapter: string; query: string; raw_content: string; scraped_at: string; label: string | null; score: number }>();

  if (!rows.length) return "No new signals since last run.";

  const grouped: Record<string, typeof rows> = {};
  for (const row of rows) {
    if (!grouped[row.adapter]) grouped[row.adapter] = [];
    grouped[row.adapter].push(row);
  }

  const LABELS: Record<string, string> = {
    jobs: "JOBS", hackernews: "HACKER NEWS", reposearch: "GITHUB REPOS",
    github: "REPO STATS", reddit: "REDDIT", yc: "YC COMPANIES",
    packagetrends: "PACKAGES", finance: "FINANCE",
  };

  const lines = [
    `# FreshContext Briefing — ${new Date().toISOString().slice(0, 16)} UTC`,
    `${rows.length} signal(s) across ${Object.keys(grouped).length} source(s)`,
    "",
  ];

  for (const [adapter, adapterRows] of Object.entries(grouped)) {
    lines.push(`## [${LABELS[adapter] ?? adapter.toUpperCase()}]`);
    for (const row of adapterRows) {
      const label = row.label ?? row.query;
      const signal = row.score >= 70 ? "HIGH" : row.score >= 50 ? "MED" : "LOW";
      lines.push(`### ${label} · Rt:${Math.round(row.score)} [${signal}]`);
      lines.push(row.raw_content.slice(0, 400).replace(/\n{3,}/g, "\n\n"));
      lines.push("");
    }
  }

  const text = lines.join("\n");

  await db.prepare(`UPDATE scrape_results SET is_new = 0 WHERE is_new = 1`).run();

  const briefingId = `br_fmt_${Date.now()}`;
  await db.prepare(
    `INSERT INTO briefings (id, user_id, summary, new_results_count, adapters_run, created_at) VALUES (?, 'default', ?, ?, ?, datetime('now'))`
  ).bind(briefingId, text, rows.length, JSON.stringify(Object.keys(grouped))).run();

  return text;
}

// ─── Worker Export ────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // ── GET /watched-queries ─────────────────────────────────────────────────
    if (url.pathname === "/watched-queries") {
      try { checkAuth(request, env); } catch (e: any) { return errResponse(e.message, 401); }
      try {
        const { results } = await env.DB.prepare(
          `SELECT id, adapter, query, label, filters, enabled, last_run_at FROM watched_queries ORDER BY adapter, id`
        ).all();
        return new Response(JSON.stringify({ count: results.length, queries: results }), {
          headers: { "Content-Type": "application/json" },
        });
      } catch (err: any) { return errResponse(err.message, 500); }
    }

    // ── GET /briefing — latest stored briefing ────────────────────────────────
    if (url.pathname === "/briefing") {
      try { checkAuth(request, env); } catch (e: any) { return errResponse(e.message, 401); }
      try {
        const latest = await env.DB.prepare(
          `SELECT * FROM briefings ORDER BY created_at DESC LIMIT 1`
        ).first<{ id: string; summary: string; new_results_count: number; adapters_run: string; created_at: string }>();
        if (!latest) return new Response(JSON.stringify({ message: "No briefings yet. Cron runs every 6h." }), { headers: { "Content-Type": "application/json" } });
        return new Response(JSON.stringify({ ...latest, adapters_run: JSON.parse(latest.adapters_run ?? "[]") }), { headers: { "Content-Type": "application/json" } });
      } catch (err: any) { return errResponse(err.message, 500); }
    }

    // ── GET /v1/intel/feed/:profile_id — structured intelligence feed ─────────
    // Returns top signals ranked by Rt score, formatted for agent consumption.
    if (url.pathname.startsWith("/v1/intel/feed/")) {
      try { checkAuth(request, env); } catch (e: any) { return errResponse(e.message, 401); }
      const profileId = url.pathname.split("/").pop() ?? "default";
      const limit = parseInt(url.searchParams.get("limit") ?? "20");
      const minRt = parseFloat(url.searchParams.get("min_rt") ?? "0");

      try {
        const { results: signals } = await env.DB.prepare(`
          SELECT
            sr.id, sr.adapter, sr.query, sr.raw_content,
            sr.scraped_at, sr.published_at,
            sr.base_score, sr.rt_score, sr.ha_pri_sig, sr.entropy_level,
            wq.label
          FROM scrape_results sr
          JOIN watched_queries wq ON sr.watched_query_id = wq.id
          WHERE wq.user_id = ?
            AND (sr.is_relevant IS NULL OR sr.is_relevant = 1)
            AND COALESCE(sr.rt_score, sr.relevancy_score, 0) >= ?
          ORDER BY COALESCE(sr.rt_score, sr.relevancy_score, 0) DESC
          LIMIT ?
        `).bind(profileId, minRt, limit).all<{
          id: string; adapter: string; query: string; raw_content: string;
          scraped_at: string; published_at: string | null;
          base_score: number | null; rt_score: number | null;
          ha_pri_sig: string | null; entropy_level: string | null;
          label: string | null;
        }>();

        const feed = {
          feed_metadata: {
            profile_id: profileId,
            generated_at: new Date().toISOString(),
            signal_count: signals.length,
            version: "freshcontext-1.1",
          },
          signals: signals.map(s => ({
            signal_id: s.id,
            source: s.adapter,
            label: s.label ?? s.query,
            content: {
              preview: s.raw_content.slice(0, 400),
              url: s.query,
            },
            intelligence_stamps: {
              scraped_at: s.scraped_at,
              published_at: s.published_at ?? null,
              base_score: s.base_score ?? null,
              rt_score: s.rt_score ?? null,
              entropy_level: s.entropy_level ?? "unknown",
              ha_pri_sig: s.ha_pri_sig ?? null,
            },
          })),
        };

        return new Response(JSON.stringify(feed), {
          headers: { "Content-Type": "application/json" },
        });
      } catch (err: any) { return errResponse(err.message, 500); }
    }

    // ── DEBUG endpoints ───────────────────────────────────────────────────────

    if (url.pathname === "/debug/scrape") {
      try { checkAuth(request, env); } catch (e: any) { return errResponse(e.message, 401); }
      const adapter = url.searchParams.get("adapter") ?? "hackernews";
      const query   = url.searchParams.get("query")   ?? "mcp server";
      try {
        const raw = await runAdapter(adapter, query, {}, env);
        return new Response(JSON.stringify({ adapter, query, raw, length: raw.length }), { headers: { "Content-Type": "application/json" } });
      } catch (err: any) {
        return new Response(JSON.stringify({ adapter, query, error: err.message }), { status: 500, headers: { "Content-Type": "application/json" } });
      }
    }

    if (url.pathname === "/debug/db") {
      try { checkAuth(request, env); } catch (e: any) { return errResponse(e.message, 401); }
      const [wq, sr, br, up] = await Promise.all([
        env.DB.prepare("SELECT COUNT(*) as n FROM watched_queries").first<{n:number}>(),
        env.DB.prepare("SELECT COUNT(*) as n FROM scrape_results").first<{n:number}>(),
        env.DB.prepare("SELECT COUNT(*) as n FROM briefings").first<{n:number}>(),
        env.DB.prepare("SELECT COUNT(*) as n FROM user_profiles").first<{n:number}>(),
      ]);
      // Also show a sample of recent scores
      const { results: recent } = await env.DB.prepare(
        `SELECT adapter, query, rt_score, base_score, entropy_level, ha_pri_sig, scraped_at FROM scrape_results ORDER BY scraped_at DESC LIMIT 5`
      ).all();
      return new Response(JSON.stringify({
        counts: { watched_queries: wq?.n, scrape_results: sr?.n, briefings: br?.n, user_profiles: up?.n },
        recent_signals: recent,
      }), { headers: { "Content-Type": "application/json" } });
    }

    // ── POST /briefing/now — force synthesis ──────────────────────────────────
    if (url.pathname === "/briefing/now" && request.method === "POST") {
      try { checkAuth(request, env); } catch (e: any) { return errResponse(e.message, 401); }
      try {
        await runScheduledScrape(env);
        // Use Claude synthesis if key is set, fallback to local formatter
        let briefingText: string;
        if (env.ANTHROPIC_KEY) {
          const aiResult = await generateAIBriefing(env.DB, env.ANTHROPIC_KEY);
          briefingText = aiResult?.summary ?? await formatBriefing(env.DB);
        } else {
          briefingText = await formatBriefing(env.DB);
        }
        return new Response(JSON.stringify({ briefing: briefingText }), { headers: { "Content-Type": "application/json" } });
      } catch (err: any) { return errResponse(err.message, 500); }
    }

    // ── MCP transport ─────────────────────────────────────────────────────────
    try {
      checkAuth(request, env);
      const ip = getClientIp(request);
      await checkRateLimit(ip, env.RATE_LIMITER);
    } catch (err: any) {
      const status = err.message.startsWith("Unauthorized") ? 401 : 429;
      return errResponse(err.message, status);
    }

    const transport = new WebStandardStreamableHTTPServerTransport();
    const server = createServer(env);
    await server.connect(transport);
    return transport.handleRequest(request);
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil((async () => {
      await runScheduledScrape(env);
      try {
        if (env.ANTHROPIC_KEY) {
          await generateAIBriefing(env.DB, env.ANTHROPIC_KEY);
        } else {
          await formatBriefing(env.DB);
        }
      } catch (err: any) {
        console.error("Briefing error:", err.message);
      }
    })());
  },
} satisfies ExportedHandler<Env>;
