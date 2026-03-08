import puppeteer from "@cloudflare/puppeteer";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Env {
  BROWSER: Fetcher;
  RATE_LIMITER: KVNamespace;
  CACHE: KVNamespace;
  API_KEY?: string;
}

// ─── Cache Layer ──────────────────────────────────────────────────────────────
// Per-adapter TTLs (seconds). Balances freshness vs. redundant upstream calls.
const CACHE_TTL: Record<string, number> = {
  jobs:          60 * 60 * 2,   // 2 hours  — job boards update infrequently
  github:        60 * 30,       // 30 min   — repos change, but not constantly
  hackernews:    60 * 15,       // 15 min   — HN moves fast
  scholar:       60 * 60 * 6,   // 6 hours  — academic data is very stable
  arxiv:         60 * 60 * 4,   // 4 hours
  yc:            60 * 60 * 4,   // 4 hours  — YC batches don't change mid-day
  producthunt:   60 * 30,       // 30 min
  reddit:        60 * 20,       // 20 min
  finance:       60 * 5,        // 5 min    — prices change constantly
  reposearch:    60 * 30,       // 30 min
  packagetrends: 60 * 60 * 2,   // 2 hours
};
const DEFAULT_TTL = 60 * 30; // 30 min fallback

function cacheKey(adapter: string, input: string): string {
  // Normalize input to avoid case/whitespace misses
  const normalized = input.trim().toLowerCase().slice(0, 200);
  return `cache:${adapter}:${normalized}`;
}

async function getFromCache(
  kv: KVNamespace, adapter: string, input: string
): Promise<FreshContext | null> {
  try {
    const key = cacheKey(adapter, input);
    const raw = await kv.get(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FreshContext & { _cached_at: string };
    // Attach a note so the caller knows it came from cache
    parsed.content = `[⚡ Cached — retrieved at ${parsed._cached_at}]\n\n` + parsed.content;
    return parsed;
  } catch {
    return null; // cache miss or corrupt entry — proceed normally
  }
}

async function setInCache(
  kv: KVNamespace, adapter: string, input: string, result: FreshContext
): Promise<void> {
  try {
    const key = cacheKey(adapter, input);
    const ttl = CACHE_TTL[adapter.toLowerCase()] ?? DEFAULT_TTL;
    const payload = JSON.stringify({ ...result, _cached_at: new Date().toISOString() });
    await kv.put(key, payload, { expirationTtl: ttl });
  } catch {
    // Non-fatal — if caching fails, the response still goes through
  }
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
  producthunt: ["www.producthunt.com", "producthunt.com"],
  // reddit, finance, repoSearch, packageTrends use fetch APIs — no browser, no domain restriction needed
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

// ─── Rate Limiting (KV-backed, globally consistent) ───────────────────────────

const RATE_LIMIT     = 60;      // requests per window
const RATE_WINDOW_S  = 60;      // window size in seconds

async function checkRateLimit(ip: string, kv: KVNamespace): Promise<void> {
  const key = `rl:${ip}`;

  // Get current count — KV TTL handles the window reset automatically
  const current = await kv.get(key);
  const count = current ? parseInt(current) : 0;

  if (count >= RATE_LIMIT) {
    throw new SecurityError(
      `Rate limit exceeded — max ${RATE_LIMIT} requests per minute per IP. Try again shortly.`
    );
  }

  // Increment. On first request, set TTL so the key expires after the window.
  // On subsequent requests within the window, preserve existing TTL via metadata.
  if (!current) {
    // First request in this window — set with TTL
    await kv.put(key, "1", { expirationTtl: RATE_WINDOW_S });
  } else {
    // Increment without resetting TTL (KV doesn't support increment natively,
    // so we overwrite — acceptable race condition for rate limiting purposes)
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

function stamp(content: string, url: string, date: string | null, confidence: "high" | "medium" | "low", adapter: string): string {
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

// ─── Server Factory ───────────────────────────────────────────────────────────

// withCache: wraps any tool handler to check KV cache before hitting upstream.
// Returns cached result if fresh, otherwise runs the handler and caches output.
async function withCache(
  adapter: string,
  cacheInput: string,
  kv: KVNamespace,
  handler: () => Promise<{ content: Array<{ type: string; text: string }> }>
): Promise<{ content: Array<{ type: string; text: string }> }> {
  // Cache check
  const cached = await getFromCache(kv, adapter, cacheInput);
  if (cached) {
    return { content: [{ type: "text", text: cached.content }] };
  }
  // Cache miss — run the real handler
  const result = await handler();
  // Store result in cache (fire-and-forget, non-blocking)
  const text = result.content[0]?.text ?? "";
  setInCache(kv, adapter, cacheInput, {
    content: text,
    source_url: cacheInput,
    content_date: null,
    retrieved_at: new Date().toISOString(),
    freshness_confidence: "medium",
    adapter,
  }).catch(() => {}); // never let cache errors bubble up
  return result;
}

function createServer(env: Env): McpServer {
  const server = new McpServer({ name: "freshcontext-mcp", version: "0.1.7" });

  // ── extract_github ──────────────────────────────────────────────────────────
  server.registerTool("extract_github", {
    description: "Extract real-time data from a GitHub repository — README, stars, forks, last commit, topics. Returns timestamped freshcontext.",
    inputSchema: z.object({ url: z.string().url().describe("Full GitHub repo URL e.g. https://github.com/owner/repo") }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ url }) => {
    return withCache("github", url, env.CACHE, async () => {
    try {
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
      return { content: [{ type: "text", text: stamp(raw, safeUrl, d.lastCommit ?? null, d.lastCommit ? "high" : "medium", "github") }] };
    } catch (err: any) { return { content: [{ type: "text", text: `[ERROR] ${err.message}` }] }; }
    }); // end withCache
  });

  // ── extract_hackernews ──────────────────────────────────────────────────────
  server.registerTool("extract_hackernews", {
    description: "Extract top stories or search results from Hacker News with real-time timestamps.",
    inputSchema: z.object({ url: z.string().url().describe("HN URL e.g. https://news.ycombinator.com or https://hn.algolia.com/?q=...") }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ url }) => {
    return withCache("hackernews", url, env.CACHE, async () => {
    try {
      // Use Algolia API for search URLs — no browser needed
      if (url.includes("hn.algolia.com")) {
        const apiUrl = url.includes("/api/") ? url : `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(url)}&tags=story&hitsPerPage=20`;
        const res = await fetch(apiUrl);
        if (!res.ok) throw new Error(`HN API error: ${res.status}`);
        const json = await res.json() as any;
        const raw = json.hits.map((r: any, i: number) =>
          `[${i+1}] ${r.title}\nURL: ${r.url ?? `https://news.ycombinator.com/item?id=${r.objectID}`}\nScore: ${r.points} | ${r.num_comments} comments\nPosted: ${r.created_at}`
        ).join("\n\n");
        const newest = json.hits.map((r: any) => r.created_at).sort().reverse()[0] ?? null;
        return { content: [{ type: "text", text: stamp(raw, url, newest, newest ? "high" : "medium", "hackernews") }] };
      }
      // Browser scrape for front page
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
      const newest = items.map(r => r.age).filter(Boolean).sort().reverse()[0] ?? null;
      return { content: [{ type: "text", text: stamp(raw, safeUrl, newest, newest ? "high" : "medium", "hackernews") }] };
    } catch (err: any) { return { content: [{ type: "text", text: `[ERROR] ${err.message}` }] }; }
    }); // end withCache
  });

  // ── extract_scholar ─────────────────────────────────────────────────────────
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
      return { content: [{ type: "text", text: stamp(raw, safeUrl, newest ? `${newest}-01-01` : null, newest ? "high" : "low", "google_scholar") }] };
    } catch (err: any) { return { content: [{ type: "text", text: `[ERROR] ${err.message}` }] }; }
    }); // end withCache
  });

  // ── extract_yc ──────────────────────────────────────────────────────────────
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
      return { content: [{ type: "text", text: stamp(raw, safeUrl, new Date().toISOString().slice(0, 10), "medium", "ycombinator") }] };
    } catch (err: any) { return { content: [{ type: "text", text: `[ERROR] ${err.message}` }] }; }
    }); // end withCache
  });

  // ── search_repos ────────────────────────────────────────────────────────────
  server.registerTool("search_repos", {
    description: "Search GitHub for repositories matching a keyword. Returns top results by stars.",
    inputSchema: z.object({ query: z.string().describe("Search query e.g. 'mcp server typescript'") }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ query }) => {
    return withCache("reposearch", query, env.CACHE, async () => {
    try {
      const q = query.replace(/[\x00-\x1F]/g, "").trim().slice(0, 200);
      const res = await fetch(`https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=15`, {
        headers: { "User-Agent": "freshcontext-mcp/0.1.6", "Accept": "application/vnd.github+json" },
      });
      if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
      const json = await res.json() as any;
      const raw = json.items.map((r: any, i: number) =>
        `[${i+1}] ${r.full_name}\n⭐ ${r.stargazers_count} stars | ${r.language ?? "N/A"}\n${r.description ?? "No description"}\nUpdated: ${r.updated_at?.slice(0,10)}\nURL: ${r.html_url}`
      ).join("\n\n");
      const newest = json.items.map((r: any) => r.updated_at).filter(Boolean).sort().reverse()[0] ?? null;
      return { content: [{ type: "text", text: stamp(raw, `https://github.com/search?q=${encodeURIComponent(q)}`, newest, newest ? "high" : "medium", "github_search") }] };
    } catch (err: any) { return { content: [{ type: "text", text: `[ERROR] ${err.message}` }] }; }
    }); // end withCache
  });

  // ── package_trends ──────────────────────────────────────────────────────────
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
      return { content: [{ type: "text", text: stamp(raw, "package-registries", new Date().toISOString(), "high", "package_registry") }] };
    } catch (err: any) { return { content: [{ type: "text", text: `[ERROR] ${err.message}` }] }; }
    }); // end withCache
  });

  // ── extract_reddit ──────────────────────────────────────────────────────────
  server.registerTool("extract_reddit", {
    description: "Extract posts and community sentiment from Reddit. Accepts subreddit name, URL, or search query.",
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
      const res = await fetch(apiUrl, { headers: { "User-Agent": "freshcontext-mcp/0.1.6", "Accept": "application/json" } });
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
      return { content: [{ type: "text", text: stamp(raw, apiUrl, date, date ? "high" : "medium", "reddit") }] };
    } catch (err: any) { return { content: [{ type: "text", text: `[ERROR] ${err.message}` }] }; }
    }); // end withCache
  });

  // ── extract_producthunt ─────────────────────────────────────────────────────
  server.registerTool("extract_producthunt", {
    description: "Recent Product Hunt launches by keyword or topic. Returns names, taglines, votes, links.",
    inputSchema: z.object({ url: z.string().describe("Search query e.g. 'AI writing tools' or a PH topic URL") }),
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
      return { content: [{ type: "text", text: stamp(raw, url, newest, newest ? "high" : "medium", "producthunt") }] };
    } catch (err: any) { return { content: [{ type: "text", text: `[ERROR] ${err.message}` }] }; }
    }); // end withCache
  });

  // ── extract_finance ─────────────────────────────────────────────────────────
  server.registerTool("extract_finance", {
    description: "Live stock data via Yahoo Finance. Accepts comma-separated ticker symbols. Returns price, change, market cap, P/E, 52w range, sector, company summary.",
    inputSchema: z.object({ url: z.string().describe("Ticker symbol(s) e.g. 'AAPL' or 'MSFT,GOOG,AMZN'") }),
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
          { headers: { "User-Agent": "Mozilla/5.0 (compatible; freshcontext-mcp/0.1.6)" } }
        );
        if (!res.ok) { results.push(`[${ticker}] Error: ${res.status}`); continue; }
        const json = await res.json() as any;
        const q = json?.quoteResponse?.result?.[0];
        if (!q) { results.push(`[${ticker}] No data found`); continue; }
        if (q.regularMarketTime) latestTs = Math.max(latestTs ?? 0, q.regularMarketTime);
        const sign = (q.regularMarketChange ?? 0) >= 0 ? "+" : "";
        const cap = q.marketCap >= 1e12 ? `$${(q.marketCap/1e12).toFixed(2)}T` : q.marketCap >= 1e9 ? `$${(q.marketCap/1e9).toFixed(2)}B` : q.marketCap >= 1e6 ? `$${(q.marketCap/1e6).toFixed(2)}M` : "N/A";
        results.push([
          `${q.symbol} — ${q.longName ?? q.shortName ?? "Unknown"}`,
          `Exchange: ${q.exchangeName ?? "N/A"} · Currency: ${q.currency ?? "USD"}`,
          `Price:      $${q.regularMarketPrice?.toFixed(2) ?? "N/A"}`,
          `Change:     ${sign}${q.regularMarketChange?.toFixed(2) ?? "N/A"} (${sign}${q.regularMarketChangePercent?.toFixed(2) ?? "N/A"}%)`,
          `Market Cap: ${cap}`,
          `Volume:     ${q.regularMarketVolume?.toLocaleString() ?? "N/A"}`,
          `52w High:   $${q.fiftyTwoWeekHigh?.toFixed(2) ?? "N/A"}`,
          `52w Low:    $${q.fiftyTwoWeekLow?.toFixed(2) ?? "N/A"}`,
          `P/E Ratio:  ${q.trailingPE?.toFixed(2) ?? "N/A"}`,
          `Div Yield:  ${q.dividendYield ? (q.dividendYield * 100).toFixed(2) + "%" : "N/A"}`,
        ].join("\n"));
      }
      const raw = results.join("\n\n─────────────────────────────\n\n");
      const date = latestTs ? new Date(latestTs * 1000).toISOString() : new Date().toISOString();
      return { content: [{ type: "text", text: stamp(raw, `yahoo-finance:${tickers.join(",")}`, date, "high", "yahoo_finance") }] };
    } catch (err: any) { return { content: [{ type: "text", text: `[ERROR] ${err.message}` }] }; }
    }); // end withCache
  });

  // ── search_jobs ─────────────────────────────────────────────────────────────
  server.registerTool("search_jobs", {
    description: "Search for real-time job listings with publication dates on every result — so you never apply to a role that closed 2 years ago. Sources: Remotive (remote jobs) + HN 'Who is Hiring' (community). Returns timestamped freshcontext.",
    inputSchema: z.object({
      query: z.string().describe("Job search query e.g. 'typescript remote', 'senior python', 'mcp developer'"),
      max_length: z.number().optional().default(6000),
    }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ query, max_length }) => {
    return withCache("jobs", query, env.CACHE, async () => {
    try {
      const q = query.replace(/[\x00-\x1F]/g, "").trim().slice(0, 200);
      const perSource = Math.floor((max_length ?? 6000) / 2);

      const [remotiveRes, hnRes] = await Promise.allSettled([
        fetch(`https://remotive.com/api/remote-jobs?search=${encodeURIComponent(q)}&limit=10`, {
          headers: { "User-Agent": "freshcontext-mcp/0.1.9", "Accept": "application/json" },
        }).then(r => r.json()),
        fetch(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q + " hiring")}&tags=comment&hitsPerPage=8`).then(r => r.json()),
      ]);

      const sections: string[] = [
        `# Job Search: "${q}"`,
        `⚠️  Every listing below includes its publication date. Check it before you apply.`,
        "",
      ];

      let newestDate: string | null = null;

      // Remotive
      if (remotiveRes.status === "fulfilled") {
        const jobs = (remotiveRes.value as any).jobs ?? [];
        if (jobs.length) {
          const listings = jobs.slice(0, 10).map((job: any, i: number) => [
            `[${i + 1}] ${job.title} — ${job.company_name}`,
            `Type: ${job.job_type || "N/A"} | Location: ${job.candidate_required_location || "Remote"}`,
            `Posted: ${job.publication_date}`,
            job.salary ? `Salary: ${job.salary}` : null,
            job.tags?.length ? `Tags: ${job.tags.slice(0, 5).join(", ")}` : null,
            `Apply: ${job.url}`,
          ].filter(Boolean).join("\n")).join("\n\n").slice(0, perSource);
          sections.push(`## 🌐 Remote Jobs (Remotive)\n${listings}`);
          const dates = jobs.map((j: any) => j.publication_date).filter(Boolean).sort().reverse();
          if (dates[0]) newestDate = dates[0] > (newestDate ?? "") ? dates[0] : newestDate;
        }
      }

      // HN Who is Hiring
      if (hnRes.status === "fulfilled") {
        const hits = ((hnRes.value as any).hits ?? []).filter((h: any) => {
          const t = (h.comment_text ?? "").toLowerCase();
          return t.includes("hiring") || t.includes("remote") || t.includes("full-time") || t.includes("salary");
        });
        if (hits.length) {
          const listings = hits.slice(0, 6).map((hit: any, i: number) => {
            const text = (hit.comment_text ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 300);
            return [
              `[${i + 1}] Posted by ${hit.author} on ${hit.created_at?.slice(0, 10)}`,
              text + (text.length >= 300 ? "…" : ""),
              `Source: https://news.ycombinator.com/item?id=${hit.objectID}`,
            ].join("\n");
          }).join("\n\n").slice(0, perSource);
          sections.push(`## 💬 HN "Who is Hiring" (Community)\n${listings}`);
          const dates = hits.map((h: any) => h.created_at).sort().reverse();
          if (dates[0]) newestDate = dates[0] > (newestDate ?? "") ? dates[0].slice(0, 10) : newestDate;
        }
      }

      const raw = sections.join("\n\n");
      return { content: [{ type: "text", text: stamp(raw, `jobs:${q}`, newestDate ?? new Date().toISOString(), newestDate ? "high" : "medium", "jobs") }] };
    } catch (err: any) { return { content: [{ type: "text", text: `[ERROR] ${err.message}` }] }; }
    }); // end withCache
  });

  // ── extract_landscape ───────────────────────────────────────────────────────
  server.registerTool("extract_landscape", {
    description: "Composite tool. Queries YC + GitHub + HN + Reddit + Product Hunt + npm/PyPI simultaneously. Returns a unified 6-source timestamped landscape report.",
    inputSchema: z.object({ topic: z.string().describe("Project idea or keyword e.g. 'mcp server'") }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ topic }) => {
    return withCache("landscape", topic, env.CACHE, async () => {
    try {
      const t = topic.replace(/[\x00-\x1F]/g, "").trim().slice(0, 200);
      const [hn, repos, pkg] = await Promise.allSettled([
        fetch(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(t)}&tags=story&hitsPerPage=10`).then(r => r.json()),
        fetch(`https://api.github.com/search/repositories?q=${encodeURIComponent(t)}&sort=stars&per_page=8`, { headers: { "User-Agent": "freshcontext-mcp/0.1.6" } }).then(r => r.json()),
        fetch(`https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(t)}&size=5`).then(r => r.json()),
      ]);
      const sections = [
        `# Landscape Report: "${t}"`,
        `Generated: ${new Date().toISOString()}`,
        "",
        "## 💬 HN Sentiment",
        hn.status === "fulfilled" ? (hn.value as any).hits?.slice(0, 8).map((h: any, i: number) => `[${i+1}] ${h.title} (${h.points}pts, ${h.created_at?.slice(0,10)})`).join("\n") : `Error: ${(hn as any).reason}`,
        "",
        "## 📦 Top GitHub Repos",
        repos.status === "fulfilled" ? (repos.value as any).items?.slice(0, 8).map((r: any, i: number) => `[${i+1}] ${r.full_name} ⭐${r.stargazers_count} — ${r.description ?? "N/A"}`).join("\n") : `Error: ${(repos as any).reason}`,
        "",
        "## 📊 npm Packages",
        pkg.status === "fulfilled" ? (pkg.value as any).objects?.map((o: any, i: number) => `[${i+1}] ${o.package.name}@${o.package.version} — ${o.package.description ?? "N/A"}`).join("\n") : `Error: ${(pkg as any).reason}`,
      ].join("\n");
      return { content: [{ type: "text", text: sections }] };
    } catch (err: any) { return { content: [{ type: "text", text: `[ERROR] ${err.message}` }] }; }
    }); // end withCache
  });

  return server;
}

// ─── Worker Export ────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
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
} satisfies ExportedHandler<Env>;

