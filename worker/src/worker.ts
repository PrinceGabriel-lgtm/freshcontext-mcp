import puppeteer from "@cloudflare/puppeteer";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import {
  EvaluateContextInputError,
  evaluateContextInput,
  formatEvaluateContextResult,
} from "../../src/tools/evaluateContext.js";
import { synthesizeBriefing as generateAIBriefing } from "./synthesize.js";
import { scoreSignal, parseStoredProfile, semanticFingerprint, isDuplicate, applyDecay, RT_EXPIRY_FLOOR } from "./intelligence.js";
import {
  analyzeCompositeContent,
  isUncacheableContent,
  parseFreshContextJson,
  replaceFreshContextJson,
  stamp,
} from "./freshcontextEnvelope.js";

const SERVICE_VERSION = "0.3.21";
const SERVICE_UA = `freshcontext-mcp/${SERVICE_VERSION} (https://github.com/PrinceGabriel-lgtm/freshcontext-mcp)`;

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

// ─── Types ────────────────────────────────────────────────────────────────────

interface Env {
  BROWSER: Fetcher;
  RATE_LIMITER: KVNamespace;
  CACHE: KVNamespace;
  DB: D1Database;
  ASSETS: Fetcher;  // Static assets binding for /demo (configured in wrangler.jsonc)
  API_KEY?: string;
  ANTHROPIC_KEY?: string;
  GITHUB_TOKEN?: string;
  PH_TOKEN?: string;
}

type LogEventName = "adapter_error" | "route_error" | "cron_error" | "source_fetch_error" | "mcp_transport_lifecycle_error" | "cache_error";

type LogFields = {
  request_id?: string;
  cron_id?: string;
  route?: string;
  method?: string;
  path?: string;
  tool?: string;
  adapter?: string;
  source_host?: string;
  status?: number;
  duration_ms?: number;
  cache_key?: string;
  ttl_seconds?: number;
  watched_query_id?: string;
  input_hash?: string;
  phase?: string;
};

function sanitizeLogText(value: unknown): string {
  return String(value)
    .replace(/https?:\/\/[^\s)]+/g, (raw) => {
      try {
        const u = new URL(raw);
        return `${u.origin}${u.pathname}`;
      } catch {
        return "[url]";
      }
    })
    .slice(0, 500);
}

function errorLogFields(err: unknown): { error_name: string; error_message: string } {
  if (err instanceof Error) {
    return {
      error_name: err.name || "Error",
      error_message: sanitizeLogText(err.message),
    };
  }
  return { error_name: "Error", error_message: sanitizeLogText(err) };
}

function hashInput(input: unknown): string | undefined {
  if (input === undefined || input === null) return undefined;
  const raw = typeof input === "string" ? input : JSON.stringify(input);
  return simpleHash(raw.slice(0, 500));
}

function sourceHost(input: string | URL | Request): string | undefined {
  try {
    const raw = input instanceof Request ? input.url : String(input);
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function logEvent(event: LogEventName, fields: LogFields = {}, err?: unknown): void {
  const payload: Record<string, unknown> = {
    event,
    level: "error",
    service: "freshcontext-mcp",
    version: SERVICE_VERSION,
    timestamp: new Date().toISOString(),
    ...fields,
    ...(err === undefined ? {} : errorLogFields(err)),
  };

  for (const key of Object.keys(payload)) {
    if (payload[key] === undefined || payload[key] === null || payload[key] === "") {
      delete payload[key];
    }
  }

  console.error(payload);
}

async function sourceFetch(
  input: string | URL | Request,
  init?: RequestInit,
  fields: LogFields = {}
): Promise<Response> {
  const started = Date.now();
  try {
    const res = await fetch(input, init);
    if (!res.ok) {
      logEvent("source_fetch_error", {
        ...fields,
        source_host: sourceHost(input),
        status: res.status,
        duration_ms: Date.now() - started,
      });
    }
    return res;
  } catch (err) {
    logEvent("source_fetch_error", {
      ...fields,
      source_host: sourceHost(input),
      duration_ms: Date.now() - started,
    }, err);
    throw err;
  }
}

function isAllowedRoute(pathname: string): boolean {
  return pathname === ""
    || pathname === "/"
    || pathname === "/health"
    || pathname === "/demo"
    || pathname.startsWith("/demo/")
    || pathname === "/mcp"
    || pathname === "/mcp/"
    || pathname === "/watched-queries"
    || pathname === "/briefing"
    || pathname === "/briefing/now"
    || pathname === "/debug/db"
    || pathname === "/debug/scrape"
    || pathname.startsWith("/v1/intel/feed/");
}

function routeName(pathname: string): string {
  if (pathname === "" || pathname === "/") return "/";
  if (pathname === "/demo" || pathname.startsWith("/demo/")) return "/demo";
  if (pathname === "/mcp" || pathname === "/mcp/") return "/mcp";
  if (pathname.startsWith("/v1/intel/feed/")) return "/v1/intel/feed/:profile_id";
  return pathname;
}

// ─── Schema Migrations ────────────────────────────────────────────────────────
//
// Idempotent ALTER TABLE statements. Pulled to module scope so any DB-touching
// path can ensure them before querying — not just the cron. This eliminates
// the "deploy → wait for cron → API works" gap.
//
// Promise gate: concurrent requests in the same isolate share one migration
// run. After it resolves, subsequent calls are O(1). On rejection, the
// cached promise is cleared so the next request can retry (handles transient
// D1 outages without permanently breaking the worker).

const SCRAPE_RESULTS_MIGRATIONS = [
  `ALTER TABLE scrape_results ADD COLUMN relevancy_score INTEGER DEFAULT 0`,
  `ALTER TABLE scrape_results ADD COLUMN is_relevant INTEGER DEFAULT 1`,
  `ALTER TABLE scrape_results ADD COLUMN base_score INTEGER DEFAULT 0`,
  `ALTER TABLE scrape_results ADD COLUMN rt_score REAL DEFAULT 0`,
  `ALTER TABLE scrape_results ADD COLUMN ha_pri_sig TEXT`,
  `ALTER TABLE scrape_results ADD COLUMN entropy_level TEXT DEFAULT 'stable'`,
  `ALTER TABLE scrape_results ADD COLUMN published_at TEXT`,
  `ALTER TABLE scrape_results ADD COLUMN semantic_fingerprint TEXT`,
  `ALTER TABLE scrape_results ADD COLUMN is_expired INTEGER DEFAULT 0`,
];

let migrationsPromise: Promise<void> | null = null;

async function ensureMigrations(env: Env): Promise<void> {
  if (migrationsPromise) return migrationsPromise;
  migrationsPromise = (async () => {
    for (const sql of SCRAPE_RESULTS_MIGRATIONS) {
      try { await env.DB.prepare(sql).run(); } catch { /* column already exists — idempotent */ }
    }
  })();
  try {
    await migrationsPromise;
  } catch (err) {
    // Don't permanently cache a rejected promise — let the next request retry.
    migrationsPromise = null;
    throw err;
  }
}

// ─── Cache Layer ──────────────────────────────────────────────────────────────

const CACHE_SCHEMA_VERSION = 2;

const CACHE_TTL: Record<string, number> = {
  github:             60 * 30,
  hackernews:         60 * 15,
  scholar:            60 * 60 * 6,
  arxiv:              60 * 60 * 4,
  reddit:             60 * 20,
  yc:                 60 * 60 * 4,
  producthunt:        60 * 30,
  reposearch:         60 * 30,
  packagetrends:      60 * 60 * 2,
  finance:            60 * 5,
  jobs:               60 * 60 * 2,
  changelog:          60 * 60 * 2,
  gdelt:              60 * 30,
  gebiz:              60 * 60 * 6,
  govcontracts:       60 * 60 * 6,
  sec_filings:        60 * 60,
  landscape:          60 * 15,
  gov_landscape:      60 * 30,
  finance_landscape:  60 * 5,
  company_landscape:  60 * 60,
  idea_landscape:     60 * 15,
};
const DEFAULT_TTL = 60 * 30;

type CacheStatus = "hit" | "miss" | "bypass" | "write_skipped";

interface CacheKeyParts {
  key: string;
  inputHash: string;
}

interface FreshContextCacheEntry {
  version: number;
  key_version: string;
  tool: string;
  input_hash: string;
  cached_at: string;
  ttl_seconds: number;
  expires_at: string;
  source_url: string;
  content_date: string | null;
  freshness_confidence: "high" | "medium" | "low";
  stamp_adapter: string;
  content: string;
  partial_failures: boolean;
}

function normalizeCacheString(input: string): string {
  const trimmed = input.trim().replace(/\s+/g, " ");
  try {
    const parsed = new URL(trimmed);
    parsed.protocol = parsed.protocol.toLowerCase();
    parsed.hostname = parsed.hostname.toLowerCase();
    parsed.hash = "";
    const params = [...parsed.searchParams.entries()]
      .sort(([ak, av], [bk, bv]) => ak === bk ? av.localeCompare(bv) : ak.localeCompare(bk));
    parsed.search = params.length ? new URLSearchParams(params).toString() : "";
    return parsed.toString();
  } catch {
    return trimmed.toLowerCase();
  }
}

function normalizeCacheArgs(input: unknown): unknown {
  if (input === null || input === undefined) return null;
  if (typeof input === "string") return normalizeCacheString(input);
  if (typeof input === "number" || typeof input === "boolean") return input;
  if (Array.isArray(input)) return input.map(normalizeCacheArgs);
  if (typeof input === "object") {
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(input as Record<string, unknown>).sort()) {
      const value = (input as Record<string, unknown>)[key];
      if (value !== undefined) normalized[key] = normalizeCacheArgs(value);
    }
    return normalized;
  }
  return String(input);
}

async function sha256Hex(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle) return simpleHash(value);
  const encoded = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

async function buildCacheKey(toolName: string, input: unknown): Promise<CacheKeyParts> {
  const normalizedTool = toolName.toLowerCase();
  const canonical = JSON.stringify({
    key_version: `v${CACHE_SCHEMA_VERSION}`,
    tool: normalizedTool,
    args: normalizeCacheArgs(input),
  });
  const inputHash = await sha256Hex(canonical);
  return {
    key: `cache:v${CACHE_SCHEMA_VERSION}:${normalizedTool}:${inputHash}`,
    inputHash,
  };
}

async function getFromCache(
  kv: KVNamespace,
  toolName: string,
  input: unknown,
): Promise<{ text: string; status: CacheStatus } | null> {
  let keyParts: CacheKeyParts;
  try {
    keyParts = await buildCacheKey(toolName, input);
  } catch (err) {
    logEvent("cache_error", { tool: toolName, phase: "key_build_read" }, err);
    return null;
  }
  try {
    const raw = await kv.get(keyParts.key);
    if (!raw) return null;
    const entry = JSON.parse(raw) as FreshContextCacheEntry;
    if (entry.version !== CACHE_SCHEMA_VERSION) return null;
    const now = new Date();
    const cachedAt = new Date(entry.cached_at);
    const cacheAgeSeconds = Math.floor((now.getTime() - cachedAt.getTime()) / 1000);
    const freshText = stamp(entry.content, entry.source_url, entry.content_date, entry.freshness_confidence, entry.stamp_adapter);
    const cacheMetadata: Record<string, unknown> = {
      status: "hit" as CacheStatus,
      cached_at: entry.cached_at,
      cache_age_seconds: cacheAgeSeconds,
      ttl_seconds: entry.ttl_seconds,
      key_version: entry.key_version,
    };
    const parsed = parseFreshContextJson(freshText);
    if (parsed) {
      return { text: replaceFreshContextJson(freshText, { ...parsed, cache: cacheMetadata }), status: "hit" };
    }
    return { text: freshText, status: "hit" };
  } catch (err) {
    logEvent("cache_error", { tool: toolName, cache_key: keyParts.key, phase: "read" }, err);
    return null;
  }
}

async function setInCache(
  kv: KVNamespace,
  toolName: string,
  input: unknown,
  text: string,
  adapter: string,
): Promise<void> {
  if (isUncacheableContent(text)) return;
  const parsed = parseFreshContextJson(text);
  if (!parsed) return;
  const fc = parsed.freshcontext as Record<string, any> | undefined;
  if (!fc) return;
  const compositeAnalysis = analyzeCompositeContent(parsed.content ?? "");
  if (compositeAnalysis.allUnavailable) return;
  let keyParts: CacheKeyParts;
  try {
    keyParts = await buildCacheKey(toolName, input);
  } catch (err) {
    logEvent("cache_error", { tool: toolName, phase: "key_build_write" }, err);
    return;
  }
  const ttl = CACHE_TTL[adapter.toLowerCase()] ?? DEFAULT_TTL;
  const now = new Date();
  const entry: FreshContextCacheEntry = {
    version: CACHE_SCHEMA_VERSION,
    key_version: `v${CACHE_SCHEMA_VERSION}`,
    tool: toolName,
    input_hash: keyParts.inputHash,
    cached_at: now.toISOString(),
    ttl_seconds: ttl,
    expires_at: new Date(now.getTime() + ttl * 1000).toISOString(),
    source_url: fc.source_url ?? "",
    content_date: fc.content_date ?? null,
    freshness_confidence: fc.freshness_confidence ?? "medium",
    stamp_adapter: fc.adapter ?? adapter,
    content: parsed.content ?? "",
    partial_failures: compositeAnalysis.hasPartialFailures,
  };
  try {
    await kv.put(keyParts.key, JSON.stringify(entry), { expirationTtl: ttl });
  } catch (err) {
    logEvent("cache_error", { tool: toolName, cache_key: keyParts.key, ttl_seconds: ttl, phase: "write" }, err);
  }
}

// ─── Security ─────────────────────────────────────────────────────────────────

const ALLOWED_DOMAINS: Record<string, string[]> = {
  github:      ["github.com", "raw.githubusercontent.com"],
  scholar:     ["scholar.google.com"],
  hackernews:  ["news.ycombinator.com", "hn.algolia.com"],
  yc:          ["www.ycombinator.com", "ycombinator.com"],
  arxiv:       ["export.arxiv.org", "arxiv.org"],
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

function constantTimeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const left = enc.encode(a);
  const right = enc.encode(b);
  const max = Math.max(left.length, right.length, 1);
  let diff = left.length ^ right.length;
  for (let i = 0; i < max; i++) {
    const l = left.length ? left[i % left.length] : 0;
    const r = right.length ? right[i % right.length] : 0;
    diff |= l ^ r;
  }
  return diff === 0;
}

function checkAuth(request: Request, env: Env): void {
  if (!env.API_KEY) throw new SecurityError("API_KEY is not configured");
  const auth = request.headers.get("Authorization") ?? "";
  const prefix = "Bearer ";
  if (!auth.startsWith(prefix)) throw new SecurityError("Unauthorized");
  const token = auth.slice(prefix.length);
  if (!constantTimeEqual(token, env.API_KEY)) throw new SecurityError("Unauthorized");
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

function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

function methodNotAllowedResponse(allowedMethods: string[]): Response {
  return jsonResponse(
    { error: "Method not allowed", allowed_methods: allowedMethods },
    405,
    { Allow: allowedMethods.join(", ") }
  );
}

function requireMethod(request: Request, allowedMethods: string[]): Response | null {
  return allowedMethods.includes(request.method) ? null : methodNotAllowedResponse(allowedMethods);
}

// ─── withCache helper ─────────────────────────────────────────────────────────

type ToolResult = { content: Array<{ type: "text"; text: string }> };

async function withCache(
  adapter: string,
  cacheInput: unknown,
  kv: KVNamespace,
  ctx: ExecutionContext | null,
  handler: () => Promise<ToolResult>
): Promise<ToolResult> {
  const cached = await getFromCache(kv, adapter, cacheInput);
  if (cached) return { content: [{ type: "text", text: cached.text }] };
  const result = await handler();
  const text = result.content[0]?.text ?? "";
  const writePromise = setInCache(kv, adapter, cacheInput, text, adapter);
  if (ctx) {
    ctx.waitUntil(writePromise);
  } else {
    writePromise.catch(() => {});
  }
  return result;
}

// ─── Adapter helpers ──────────────────────────────────────────────────────────
//
// Pure data-fetch helpers used by the 6 base adapters added in Pass 4
// and by the 4 composite tools that aggregate them. Each returns
// { raw, date, conf } so the caller can stamp consistently.
//
// The legacy reference tools keep their inline logic — these helpers exist so
// composites do not have to re-inline the same fetches.

interface AdapterHit {
  raw: string;
  date: string | null;
  conf: "high" | "medium" | "low";
}

const UA = SERVICE_UA;
const SEC_UA = SERVICE_UA;

function asciiSanitize(s: string): string {
  return s.replace(/[^\x20-\x7E\n]/g, "").trim();
}

function formatUSD(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || isNaN(amount)) return "N/A";
  const abs = Math.abs(amount);
  if (abs >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `$${(amount / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(amount / 1_000).toFixed(1)}K`;
  return `$${amount.toFixed(0)}`;
}

function normalizeHnDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const match = raw.match(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?\b/);
  if (!match) return null;
  const isoLike = match[0].endsWith("Z") ? match[0] : `${match[0]}Z`;
  const parsed = new Date(isoLike);
  return isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

interface StooqQuote {
  symbol: string;
  date: string;
  time: string;
  open: number | string;
  high: number | string;
  low: number | string;
  close: number | string;
  volume: number | string;
}

interface ParsedFinanceQuote {
  requested: string;
  stooqSymbol: string;
  quote: StooqQuote;
  timestamp: string;
}

function toStooqSymbol(ticker: string): string {
  const clean = ticker.trim().toUpperCase().replace(/[^A-Z0-9.^=-]/g, "");
  if (!clean) throw new Error("Ticker cannot be empty");
  if (clean.includes(".") || clean.startsWith("^") || clean.includes("=")) return clean;
  return `${clean}.US`;
}

function quoteNumber(value: number | string | undefined): number | null {
  if (value === undefined || value === "N/D") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeQuoteTimestamp(date: string, time: string): string {
  if (!date || date === "N/D") throw new Error("Quote date unavailable");
  const clock = time && time !== "N/D" ? time : "00:00:00";
  const parsed = new Date(`${date}T${clock}Z`);
  if (isNaN(parsed.getTime())) throw new Error(`Invalid quote timestamp: ${date} ${time}`);
  return parsed.toISOString();
}

function formatQuoteValue(value: number | string | undefined, prefix = ""): string {
  const n = quoteNumber(value);
  return n === null ? "N/A" : `${prefix}${n.toLocaleString(undefined, { maximumFractionDigits: 4 })}`;
}

// ── arXiv (HTTP, Atom XML) ───────────────────────────────────────────────────
async function fetchArxiv(query: string, maxLength: number, log: LogFields = {}): Promise<AdapterHit> {
  const apiUrl = query.startsWith("http")
    ? validateUrl(query, "arxiv")
    : `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=10&sortBy=relevance&sortOrder=descending`;

  const res = await sourceFetch(apiUrl, { headers: { "User-Agent": UA } }, { ...log, adapter: "arxiv" });
  if (!res.ok) throw new Error(`arXiv API ${res.status}`);

  const xml = await res.text();
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)];
  if (!entries.length) return { raw: "No results found.", date: null, conf: "low" };

  const getTag = (block: string, tag: string): string => {
    const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
    return m ? m[1].trim().replace(/\s+/g, " ") : "";
  };

  const papers = entries.map((match, i) => {
    const block = match[1];
    const title = getTag(block, "title").replace(/\n/g, " ");
    const summary = getTag(block, "summary").slice(0, 300).replace(/\n/g, " ");
    const published = getTag(block, "published").slice(0, 10);
    const updated = getTag(block, "updated").slice(0, 10);
    const id = getTag(block, "id").replace("http://arxiv.org/abs/", "https://arxiv.org/abs/");
    const authorMatches = [...block.matchAll(/<author>([\s\S]*?)<\/author>/g)];
    const authors = authorMatches.map(a => getTag(a[1], "name")).filter(Boolean).slice(0, 4).join(", ");
    return [
      `[${i + 1}] ${title}`,
      `Authors: ${authors || "Unknown"}`,
      `Published: ${published}${updated && updated !== published ? ` (updated ${updated})` : ""}`,
      `Abstract: ${summary}…`,
      `Link: ${id}`,
    ].join("\n");
  });

  const raw = papers.join("\n\n").slice(0, maxLength);
  const dates = entries
    .map(m => getTag(m[1], "published").slice(0, 10))
    .filter(Boolean)
    .sort()
    .reverse();
  const date = dates[0] ?? null;
  return { raw, date, conf: date ? "high" : "medium" };
}

// ── Changelog (npm registry + GitHub Releases; no browser fallback) ──────────
async function fetchChangelog(input: string, maxLength: number, log: LogFields = {}): Promise<AdapterHit> {
  // npm package name — no protocol, no slash
  if (!input.startsWith("http") && !input.includes("/") && input.length > 0) {
    const res = await sourceFetch(`https://registry.npmjs.org/${encodeURIComponent(input)}`, {
      headers: { "User-Agent": UA },
    }, { ...log, adapter: "changelog" });
    if (!res.ok) throw new Error(`npm registry ${res.status}`);
    const data = await res.json() as {
      name: string;
      description?: string;
      time?: Record<string, string>;
      "dist-tags"?: { latest?: string };
    };
    const times = data.time ?? {};
    const versions = Object.keys(times)
      .filter(k => k !== "created" && k !== "modified" && /^\d/.test(k))
      .sort((a, b) => new Date(times[b]).getTime() - new Date(times[a]).getTime())
      .slice(0, 10);
    const latest = data["dist-tags"]?.latest ?? versions[0] ?? "?";
    const raw = [
      `Package: ${data.name}`,
      `Description: ${data.description ?? "N/A"}`,
      `Latest: ${latest} (${times[latest]?.slice(0, 10) ?? "unknown"})`,
      ``,
      `Recent versions:`,
      ...versions.map(v => `  ${v} — ${times[v]?.slice(0, 10) ?? "unknown"}`),
    ].join("\n").slice(0, maxLength);
    const newest = versions[0] ? times[versions[0]] : null;
    return { raw, date: newest ?? null, conf: newest ? "high" : "medium" };
  }

  // GitHub repo URL → Releases API
  const ghMatch = input.match(/github\.com\/([^/]+)\/([^/?\s]+)/);
  if (ghMatch) {
    const owner = ghMatch[1];
    const repo = ghMatch[2].replace(/\.git$/, "");
    const res = await sourceFetch(`https://api.github.com/repos/${owner}/${repo}/releases?per_page=10`, {
      headers: { "Accept": "application/vnd.github.v3+json", "User-Agent": UA },
    }, { ...log, adapter: "changelog" });
    if (!res.ok) throw new Error(`GitHub releases ${res.status}`);
    const releases = await res.json() as Array<{
      tag_name: string; name: string; published_at: string; body: string;
      prerelease: boolean; draft: boolean;
    }>;
    if (!releases.length) throw new Error("No releases found");
    const stable = releases.filter(r => !r.prerelease && !r.draft);
    const items = stable.length ? stable : releases;
    const raw = items.slice(0, 8).map((r, i) => {
      const body = asciiSanitize(r.body ?? "").slice(0, 500);
      return [
        `[${i + 1}] ${r.tag_name}${r.name && r.name !== r.tag_name ? ` — ${r.name}` : ""}`,
        `Released: ${r.published_at?.slice(0, 10) ?? "unknown"}`,
        body ? `\n${body}` : "(no release notes)",
      ].join("\n");
    }).join("\n\n").slice(0, maxLength);
    const newest = items[0]?.published_at ?? null;
    return { raw, date: newest, conf: "high" };
  }

  throw new Error("Changelog: pass an npm package name (e.g. 'react') or a GitHub repo URL. Arbitrary URL discovery is not supported in the Worker.");
}

// ── GDELT (HTTP) ─────────────────────────────────────────────────────────────
async function fetchGdelt(query: string, maxLength: number, log: LogFields = {}): Promise<AdapterHit> {
  const params = new URLSearchParams({
    query, mode: "artlist", maxrecords: "15", format: "json",
    timespan: "1month", sort: "DateDesc",
  });
  const res = await sourceFetch(`https://api.gdeltproject.org/api/v2/doc/doc?${params}`, {
    headers: { "Accept": "application/json", "User-Agent": SEC_UA },
  }, { ...log, adapter: "gdelt" });
  if (!res.ok) throw new Error(`GDELT ${res.status}`);
  const text = await res.text();
  if (!text.trim() || text.trim() === "null") {
    return { raw: `No GDELT articles for "${query}".`, date: null, conf: "high" };
  }
  const data = JSON.parse(text) as {
    articles?: Array<{
      url?: string; title?: string; seendate?: string;
      domain?: string; language?: string; sourcecountry?: string;
    }>;
  };
  const articles = data.articles ?? [];
  if (!articles.length) {
    return { raw: `No GDELT articles for "${query}" in last 30 days.`, date: null, conf: "high" };
  }

  const parseDate = (raw?: string): string | null => {
    if (!raw) return null;
    const m = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
    return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : null;
  };

  const lines: string[] = [
    `GDELT Global News — ${query}`,
    `${articles.length} articles (last 30 days)`,
    "",
  ];
  let latest: string | null = null;
  articles.forEach((a, i) => {
    const date = parseDate(a.seendate);
    if (date && (!latest || date > latest)) latest = date;
    lines.push(`[${i + 1}] ${(a.title ?? "No title").slice(0, 200)}`);
    lines.push(`    Source: ${a.domain ?? "?"} (${a.sourcecountry ?? "?"})  Lang: ${a.language ?? "?"}`);
    lines.push(`    Date:   ${date ?? a.seendate ?? "?"}`);
    if (a.url) lines.push(`    URL:    ${a.url.slice(0, 200)}`);
    lines.push("");
  });
  return { raw: lines.join("\n").slice(0, maxLength), date: latest, conf: "high" };
}

// ── GeBIZ (Singapore data.gov.sg) ────────────────────────────────────────────
async function fetchGebiz(query: string, maxLength: number, log: LogFields = {}): Promise<AdapterHit> {
  const params = new URLSearchParams({
    resource_id: "d_acde1106003906a75c3fa052592f2fcb",
    limit: "15",
    sort: "_id desc",
  });
  if (query.trim()) params.set("q", query.trim());
  const res = await sourceFetch(`https://data.gov.sg/api/action/datastore_search?${params}`, {
    headers: { "Accept": "application/json", "User-Agent": SEC_UA },
  }, { ...log, adapter: "gebiz" });
  if (!res.ok) throw new Error(`GeBIZ ${res.status}`);
  const data = await res.json() as {
    result?: { records?: Array<Record<string, string>>; total?: number };
  };
  const records = data.result?.records ?? [];
  const total = data.result?.total ?? 0;
  if (!records.length) {
    return { raw: `No GeBIZ tenders for "${query || "(all)"}"`, date: null, conf: "high" };
  }

  const fmtAmt = (raw?: string): string => {
    if (!raw || raw === "NA" || raw === "") return "N/A";
    const n = parseFloat(raw.replace(/[^0-9.]/g, ""));
    if (isNaN(n)) return raw;
    if (n >= 1_000_000) return `S$${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000) return `S$${(n / 1_000).toFixed(1)}K`;
    return `S$${n.toFixed(0)}`;
  };

  const lines: string[] = [
    `GeBIZ Singapore Procurement — ${query || "All Recent"}`,
    `${total.toLocaleString()} total (showing ${records.length})`,
    "",
  ];
  let latest: string | null = null;
  records.forEach((r, i) => {
    const dateStr = r.awarded_date ?? r.tender_close_date ?? null;
    if (dateStr && dateStr !== "NA") {
      const parts = dateStr.split("/");
      let iso: string | null = null;
      if (parts.length === 3) iso = `${parts[2]}-${parts[1]}-${parts[0]}`;
      else if (dateStr.length >= 10) iso = dateStr.slice(0, 10);
      if (iso && (!latest || iso > latest)) latest = iso;
    }
    lines.push(`[${i + 1}] ${(r.description ?? "No description").slice(0, 300)}`);
    lines.push(`    Agency:    ${r.agency ?? "N/A"}`);
    lines.push(`    Tender No: ${r.tender_no ?? "N/A"}`);
    lines.push(`    Status:    ${r.tender_detail_status ?? "N/A"}`);
    if (r.supplier_name && r.supplier_name !== "N/A") lines.push(`    Supplier:  ${r.supplier_name}`);
    const amt = fmtAmt(r.awarded_amt);
    if (amt !== "N/A") lines.push(`    Amount:    ${amt}`);
    if (r.tender_close_date) lines.push(`    Closes:    ${r.tender_close_date.slice(0, 10)}`);
    if (r.awarded_date) lines.push(`    Awarded:   ${r.awarded_date.slice(0, 10)}`);
    lines.push("");
  });
  return { raw: lines.join("\n").slice(0, maxLength), date: latest, conf: "high" };
}

// ── USASpending.gov contracts ────────────────────────────────────────────────
const CONTRACT_FIELDS = [
  "Award ID", "Recipient Name", "Award Amount", "Award Date",
  "Start Date", "End Date", "Awarding Agency", "Awarding Sub Agency",
  "Description", "Place of Performance State Code", "Place of Performance City Name",
  "naics_code", "naics_description",
];

async function fetchGovContracts(query: string, maxLength: number, log: LogFields = {}): Promise<AdapterHit> {
  const input = query.trim();
  if (!input) throw new Error("Query required: company name, keyword, or NAICS code");

  const buildBody = (filters: object, days = 730): object => ({
    filters: {
      ...filters,
      time_period: [{
        start_date: new Date(Date.now() - days * 86400000).toISOString().slice(0, 10),
        end_date: new Date().toISOString().slice(0, 10),
      }],
      award_type_codes: ["A", "B", "C", "D"],
    },
    fields: CONTRACT_FIELDS,
    page: 1, limit: 10, sort: "Award Amount", order: "desc", subawards: false,
  });

  const post = async (body: object) => {
    const res = await sourceFetch("https://api.usaspending.gov/api/v2/search/spending_by_award/", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json", "User-Agent": SEC_UA },
      body: JSON.stringify(body),
    }, { ...log, adapter: "govcontracts" });
    if (!res.ok) throw new Error(`USASpending ${res.status}`);
    return await res.json() as { results?: Array<Record<string, string | number | null>> };
  };

  let data: { results?: Array<Record<string, string | number | null>> };
  if (/^\d{6}$/.test(input)) {
    data = await post(buildBody({ keywords: [input] }, 365));
  } else {
    data = await post(buildBody({ recipient_search_text: [input] }));
    if (!data.results?.length) data = await post(buildBody({ keywords: [input] }, 365));
  }

  const results = data.results ?? [];
  if (!results.length) {
    return {
      raw: `No federal contracts found for "${input}".`,
      date: null, conf: "high",
    };
  }

  const lines: string[] = [`Federal contracts — ${input}`, ""];
  results.forEach((a, i) => {
    const desc = asciiSanitize(String(a["Description"] ?? "No description")).slice(0, 300);
    const location = [a["Place of Performance City Name"], a["Place of Performance State Code"]]
      .filter(Boolean).join(", ") || "N/A";
    lines.push(`[${i + 1}] ${asciiSanitize(String(a["Recipient Name"] ?? "Unknown"))}`);
    lines.push(`    Amount:  ${formatUSD(typeof a["Award Amount"] === "number" ? a["Award Amount"] : null)}`);
    lines.push(`    Awarded: ${String(a["Award Date"] ?? "unknown").slice(0, 10)}`);
    lines.push(`    Period:  ${String(a["Start Date"] ?? "?").slice(0, 10)} → ${String(a["End Date"] ?? "?").slice(0, 10)}`);
    lines.push(`    Agency:  ${asciiSanitize(String(a["Awarding Agency"] ?? "N/A"))}`);
    if (a["naics_code"]) {
      lines.push(`    NAICS:   ${a["naics_code"]} — ${asciiSanitize(String(a["naics_description"] ?? ""))}`);
    }
    lines.push(`    Location: ${location}`);
    lines.push(`    Desc:    ${desc}`);
    lines.push("");
  });

  const dates = results
    .map(r => r["Award Date"])
    .filter((d): d is string => typeof d === "string" && d.length > 0)
    .sort()
    .reverse();
  return { raw: lines.join("\n").slice(0, maxLength), date: dates[0] ?? null, conf: "high" };
}

// ── SEC EDGAR 8-K ────────────────────────────────────────────────────────────
async function fetchSecFilings(query: string, maxLength: number, log: LogFields = {}): Promise<AdapterHit> {
  const q = query.trim();
  if (!q) throw new Error("Query required");
  const today = new Date().toISOString().slice(0, 10);
  const oneYearAgo = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
  const params = new URLSearchParams({
    q: `"${q}"`, forms: "8-K", dateRange: "custom",
    startdt: oneYearAgo, enddt: today, hits: "10",
  });
  const res = await sourceFetch(`https://efts.sec.gov/LATEST/search-index?${params}`, {
    headers: { "Accept": "application/json", "User-Agent": SEC_UA },
  }, { ...log, adapter: "sec_filings" });
  if (!res.ok) throw new Error(`SEC EDGAR ${res.status}`);
  const data = await res.json() as {
    hits?: { hits?: Array<{
      _id?: string;
      _source?: { period_of_report?: string; filed_at?: string; entity_name?: string;
                  form_type?: string; biz_location?: string; inc_states?: string; };
    }>; total?: { value: number } };
  };
  const hits = data.hits?.hits ?? [];
  const total = data.hits?.total?.value ?? 0;
  if (!hits.length) {
    return { raw: `No 8-K filings for "${q}" in last year.`, date: null, conf: "high" };
  }
  const lines: string[] = [
    `SEC 8-K — ${q}`,
    `${total.toLocaleString()} filings (showing ${hits.length})`,
    "",
  ];
  let latest: string | null = null;
  hits.forEach((hit, i) => {
    const src = hit._source ?? {};
    const fileDate = src.filed_at?.slice(0, 10) ?? "unknown";
    if (fileDate !== "unknown" && (!latest || fileDate > latest)) latest = fileDate;
    lines.push(`[${i + 1}] ${src.entity_name ?? "Unknown"}`);
    lines.push(`    Form:    ${src.form_type ?? "8-K"}`);
    lines.push(`    Filed:   ${fileDate}`);
    lines.push(`    Period:  ${src.period_of_report?.slice(0, 10) ?? "unknown"}`);
    lines.push(`    Location: ${[src.biz_location, src.inc_states].filter(Boolean).join(" / ") || "N/A"}`);
    lines.push(`    Filing:  ${hit._id ?? "N/A"}`);
    lines.push("");
  });
  return { raw: lines.join("\n").slice(0, maxLength), date: latest, conf: "high" };
}

// ── HN (Algolia search) — composite helper ───────────────────────────────────
async function fetchHN(query: string, maxLength: number, log: LogFields = {}): Promise<AdapterHit> {
  const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=10`;
  const res = await sourceFetch(url, undefined, { ...log, adapter: "hackernews" });
  if (!res.ok) throw new Error(`HN Algolia ${res.status}`);
  const json = await res.json() as { hits: Array<{ title: string; url: string | null; points: number; num_comments: number; author: string; created_at: string; objectID: string }> };
  if (!json.hits.length) return { raw: `No HN stories for "${query}".`, date: null, conf: "low" };
  const raw = json.hits.map((r, i) =>
    `[${i + 1}] ${r.title}\nURL: ${r.url ?? `https://news.ycombinator.com/item?id=${r.objectID}`}\nScore: ${r.points} | ${r.num_comments} comments\nAuthor: ${r.author} | Posted: ${normalizeHnDate(r.created_at) ?? r.created_at}`
  ).join("\n\n").slice(0, maxLength);
  const newest = json.hits.map(r => normalizeHnDate(r.created_at)).filter((d): d is string => Boolean(d)).sort().reverse()[0] ?? null;
  return { raw, date: newest, conf: newest ? "high" : "medium" };
}

// ── GitHub repo search — composite helper ────────────────────────────────────
async function fetchRepoSearch(query: string, maxLength: number, ghToken?: string, log: LogFields = {}): Promise<AdapterHit> {
  const q = query.replace(/[\x00-\x1F]/g, "").trim().slice(0, 200);
  const headers: Record<string, string> = { "User-Agent": UA, "Accept": "application/vnd.github+json" };
  if (ghToken) headers["Authorization"] = `Bearer ${ghToken}`;
  const res = await sourceFetch(`https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=10`, { headers }, { ...log, adapter: "reposearch" });
  if (!res.ok) throw new Error(`GitHub search ${res.status}`);
  const json = await res.json() as { items: Array<{ full_name: string; description: string | null; stargazers_count: number; forks_count: number; language: string | null; pushed_at: string; html_url: string }> };
  const raw = json.items.map((r, i) =>
    `[${i + 1}] ${r.full_name}\n⭐ ${r.stargazers_count} stars | 🍴 ${r.forks_count} | ${r.language ?? "?"}\n${r.description ?? "No description"}\nLast push: ${r.pushed_at}\nURL: ${r.html_url}`
  ).join("\n\n").slice(0, maxLength);
  const newest = json.items.map(r => r.pushed_at).filter(Boolean).sort().reverse()[0] ?? null;
  return { raw, date: newest, conf: newest ? "high" : "medium" };
}

// ── Reddit — composite helper ────────────────────────────────────────────────
async function fetchReddit(query: string, maxLength: number, log: LogFields = {}): Promise<AdapterHit> {
  let apiUrl = query;
  if (!apiUrl.startsWith("http")) {
    const clean = apiUrl.replace(/^r\//, "");
    apiUrl = `https://www.reddit.com/search.json?q=${encodeURIComponent(clean)}&sort=new&limit=15`;
  } else {
    if (!apiUrl.includes(".json")) apiUrl = apiUrl.replace(/\/?$/, ".json");
    if (!apiUrl.includes("limit=")) apiUrl += (apiUrl.includes("?") ? "&" : "?") + "limit=15";
  }
  const res = await sourceFetch(apiUrl, { headers: { "User-Agent": UA, "Accept": "application/json" } }, { ...log, adapter: "reddit" });
  if (!res.ok) throw new Error(`Reddit ${res.status}`);
  const json = await res.json() as { data?: { children?: Array<{ data: { title: string; author: string; subreddit: string; score: number; num_comments: number; created_utc: number; permalink: string } }> } };
  const posts = json?.data?.children ?? [];
  if (!posts.length) return { raw: `No Reddit posts for "${query}".`, date: null, conf: "low" };
  const raw = posts.slice(0, 15).map((c, i) => {
    const p = c.data;
    const date = new Date(p.created_utc * 1000).toISOString();
    return `[${i + 1}] ${p.title}\nr/${p.subreddit} · u/${p.author} · ${date.slice(0, 10)}\n↑ ${p.score} · ${p.num_comments} comments\nhttps://reddit.com${p.permalink}`;
  }).join("\n\n").slice(0, maxLength);
  const newest = posts.map(c => c.data.created_utc).sort((a, b) => b - a)[0];
  const date = newest ? new Date(newest * 1000).toISOString() : null;
  return { raw, date, conf: date ? "high" : "medium" };
}

// ── Finance quotes (Stooq, no key) — composite helper ────────────────────────
async function fetchFinance(tickers: string, maxLength: number, log: LogFields = {}): Promise<AdapterHit> {
  const list = tickers.split(",").map(t => t.trim()).filter(Boolean).slice(0, 5);
  if (!list.length) throw new Error("At least one ticker is required");
  const successes: ParsedFinanceQuote[] = [];
  const failures: string[] = [];
  for (const t of list) {
    try {
      const stooqSymbol = toStooqSymbol(t);
      const res = await sourceFetch(
        `https://stooq.com/q/l/?s=${encodeURIComponent(stooqSymbol.toLowerCase())}&f=sd2t2ohlcv&h&e=json`,
        { headers: { "User-Agent": SERVICE_UA, "Accept": "application/json" } },
        { ...log, adapter: "finance" }
      );
      if (!res.ok) throw new Error(`Stooq quote API error: ${res.status}`);
      const json = await res.json() as { symbols?: StooqQuote[] };
      const quote = json.symbols?.[0];
      if (!quote || quote.close === "N/D" || quote.date === "N/D") throw new Error(`No Stooq quote data found for ${t}`);
      successes.push({
        requested: t,
        stooqSymbol,
        quote,
        timestamp: normalizeQuoteTimestamp(quote.date, quote.time),
      });
    } catch (e: unknown) {
      failures.push(`[${t.toUpperCase()}] ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (!successes.length) {
    throw new Error(`Finance quote lookup failed for all tickers via source=stooq. ${failures.join("; ")}`);
  }

  const out = successes.map(({ requested, quote, timestamp }) => [
    `${requested.toUpperCase()} — ${quote.symbol}`,
    `source: stooq`,
    `Quote timestamp: ${timestamp}`,
    "",
    `Close:  ${formatQuoteValue(quote.close, "$")}`,
    `Open:   ${formatQuoteValue(quote.open, "$")}`,
    `High:   ${formatQuoteValue(quote.high, "$")}`,
    `Low:    ${formatQuoteValue(quote.low, "$")}`,
    `Volume: ${formatQuoteValue(quote.volume)}`,
  ].join("\n"));
  if (failures.length) out.push(["Partial failures:", ...failures.map(f => `- ${f}`)].join("\n"));
  const raw = out.join("\n\n─────────────\n\n").slice(0, maxLength);
  const date = successes.map(s => s.timestamp).sort().reverse()[0] ?? null;
  return { raw, date, conf: failures.length ? "medium" : "high" };
}

// ── YC companies (yc-oss feed) — composite helper ────────────────────────────
async function fetchYC(query: string, maxLength: number, log: LogFields = {}): Promise<AdapterHit> {
  const res = await sourceFetch("https://yc-oss.github.io/api/companies/all.json", { headers: { "User-Agent": UA } }, { ...log, adapter: "yc" });
  if (!res.ok) throw new Error(`YC ${res.status}`);
  const all = await res.json() as Array<{ name: string; one_liner?: string; tags?: string[]; batch?: string; status?: string; website?: string }>;
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = all.filter(c => {
    const text = `${c.name ?? ""} ${c.one_liner ?? ""} ${(c.tags ?? []).join(" ")}`.toLowerCase();
    return terms.some(t => text.includes(t));
  }).slice(0, 15);
  if (!hits.length) return { raw: `No YC companies for "${query}".`, date: null, conf: "low" };
  const raw = hits.map((h, i) => [
    `[${i + 1}] ${h.name} [${h.batch ?? "?"}] ${h.status ?? ""}`,
    `Tags: ${(h.tags ?? []).join(", ") || "none"}`,
    `${h.one_liner ?? "N/A"}`,
    h.website ? `Website: ${h.website}` : null,
  ].filter(Boolean).join("\n")).join("\n\n").slice(0, maxLength);
  return { raw, date: new Date().toISOString().slice(0, 10), conf: "medium" };
}

// ── Jobs (Remotive) — composite helper ───────────────────────────────────────
async function fetchJobs(query: string, maxLength: number, log: LogFields = {}): Promise<AdapterHit> {
  const q = query.replace(/[\x00-\x1F]/g, "").trim().slice(0, 200);
  const res = await sourceFetch(`https://remotive.com/api/remote-jobs?search=${encodeURIComponent(q)}&limit=12`, {
    headers: { "User-Agent": UA, "Accept": "application/json" },
  }, { ...log, adapter: "jobs" });
  if (!res.ok) throw new Error(`Remotive ${res.status}`);
  const data = await res.json() as { jobs?: Array<{ title: string; company_name: string; job_type: string; publication_date: string; candidate_required_location: string; salary: string; url: string }> };
  const jobs = data.jobs ?? [];
  if (!jobs.length) return { raw: `No remote jobs for "${q}".`, date: null, conf: "low" };
  const raw = jobs.slice(0, 12).map((j, i) => [
    `[${i + 1}] ${j.title} — ${j.company_name}`,
    `Type: ${j.job_type || "N/A"}  Location: ${j.candidate_required_location || "Remote"}`,
    `Posted: ${j.publication_date}`,
    j.salary ? `Salary: ${j.salary}` : null,
    `Apply: ${j.url}`,
  ].filter(Boolean).join("\n")).join("\n\n").slice(0, maxLength);
  const newest = jobs.map(j => j.publication_date).filter(Boolean).sort().reverse()[0] ?? null;
  return { raw, date: newest, conf: newest ? "high" : "medium" };
}

// ── Package trends (npm + PyPI) — composite helper ──────────────────────────
async function fetchPackageTrends(packages: string, maxLength: number, log: LogFields = {}): Promise<AdapterHit> {
  const entries = packages.split(",").map(s => s.trim()).filter(Boolean).slice(0, 5);
  const out: string[] = [];
  let latest: string | null = null;
  for (const entry of entries) {
    const isExplicitPypi = entry.startsWith("pypi:");
    const isExplicitNpm = entry.startsWith("npm:");
    const name = entry.replace(/^(npm:|pypi:)/, "");
    if (!isExplicitPypi) {
      try {
          const res = await sourceFetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`, { headers: { "User-Agent": UA } }, { ...log, adapter: "packagetrends" });
        if (res.ok) {
          const j = await res.json() as { name: string; description?: string; "dist-tags"?: { latest?: string }; time?: Record<string, string> };
          const modified = j.time?.modified ?? null;
          if (modified && (!latest || modified > latest)) latest = modified;
          out.push([
            `📦 [npm] ${j.name}`,
            `Latest: ${j["dist-tags"]?.latest ?? "?"} (${modified?.slice(0, 10) ?? "?"})`,
            `Description: ${j.description ?? "N/A"}`,
          ].join("\n"));
          continue;
        }
      } catch { /* fall through */ }
    }
    if (!isExplicitNpm) {
      try {
          const res = await sourceFetch(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`, { headers: { "User-Agent": UA } }, { ...log, adapter: "packagetrends" });
        if (res.ok) {
          const j = await res.json() as { info: { name: string; version: string; summary?: string }; urls?: Array<{ upload_time: string }> };
          const upload = j.urls?.[0]?.upload_time ?? null;
          if (upload && (!latest || upload > latest)) latest = upload;
          out.push([
            `🐍 [PyPI] ${j.info.name}`,
            `Latest: ${j.info.version} (${upload?.slice(0, 10) ?? "?"})`,
            `Description: ${j.info.summary ?? "N/A"}`,
          ].join("\n"));
          continue;
        }
      } catch { /* not found */ }
    }
    out.push(`❌ Not found on npm or PyPI: ${name}`);
  }
  return { raw: out.join("\n\n").slice(0, maxLength), date: latest, conf: latest ? "high" : "low" };
}

// ── Product Hunt (GraphQL) — composite helper ────────────────────────────────
async function fetchProductHunt(query: string, maxLength: number, phToken?: string, log: LogFields = {}): Promise<AdapterHit> {
  if (!phToken) return { raw: "Product Hunt requires PH_TOKEN env binding.", date: null, conf: "low" };
  const isUrl = query.startsWith("http");
  const gql = `{ posts(first: 15, order: VOTES${isUrl ? "" : `, search: ${JSON.stringify(query)}`}) { edges { node { name tagline url votesCount commentsCount createdAt topics { edges { node { name } } } } } } }`;
  const res = await sourceFetch("https://api.producthunt.com/v2/api/graphql", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${phToken}` },
    body: JSON.stringify({ query: gql }),
  }, { ...log, adapter: "producthunt" });
  if (!res.ok) throw new Error(`Product Hunt ${res.status}`);
  const j = await res.json() as { data?: { posts?: { edges?: Array<{ node: { name: string; tagline: string; url: string; votesCount: number; commentsCount: number; createdAt: string; topics?: { edges?: Array<{ node: { name: string } }> } } }> } } };
  const edges = j?.data?.posts?.edges ?? [];
  if (!edges.length) return { raw: `No Product Hunt launches for "${query}".`, date: null, conf: "low" };
  const raw = edges.map((e, i) => {
    const p = e.node;
    const topics = p.topics?.edges?.map(t => t.node.name).join(", ") ?? "";
    return [
      `[${i + 1}] ${p.name}`,
      `"${p.tagline}"`,
      `↑ ${p.votesCount} · ${p.commentsCount} comments`,
      topics ? `Topics: ${topics}` : null,
      `Launched: ${p.createdAt?.slice(0, 10) ?? "?"}`,
      `Link: ${p.url}`,
    ].filter(Boolean).join("\n");
  }).join("\n\n").slice(0, maxLength);
  const newest = edges.map(e => e.node.createdAt).filter(Boolean).sort().reverse()[0] ?? null;
  return { raw, date: newest, conf: newest ? "high" : "medium" };
}

// ─── MCP Server ───────────────────────────────────────────────────────────────

function createServer(env: Env, ctx: ExecutionContext | null, requestLog: LogFields = {}): McpServer {
  const server = new McpServer({ name: "freshcontext-mcp", version: SERVICE_VERSION });

  const ok = (text: string): ToolResult => ({ content: [{ type: "text", text }] });
  const adapterLog = (tool: string, adapter: string, input?: unknown): LogFields => ({
    ...requestLog,
    tool,
    adapter,
    input_hash: hashInput(input),
  });
  const adapterError = (tool: string, adapter: string, input: unknown, err: unknown): ToolResult => {
    logEvent("adapter_error", adapterLog(tool, adapter, input), err);
    return ok(`[ERROR] ${err instanceof Error ? err.message : String(err)}`);
  };

  server.registerTool("evaluate_context", {
    description:
      "Evaluate caller-provided candidate context and return decision-ready output. This is the primary FreshContext judgment path: it does not fetch, crawl, scrape, browse, read folders, or call adapters.",
    inputSchema: z.object({
      profile: z.string().min(1).describe("Source Profile id, e.g. academic_research, jobs_opportunities, market_finance, official_docs, local_custom."),
      intent: z.string().min(1).describe("Intent Profile id, e.g. citation_check, student_research, developer_adoption, job_search, market_watch, business_due_diligence, medical_literature_triage."),
      signals: z.array(signalInputSchema).min(1).max(100).describe("Candidate context items provided by the caller. FreshContext evaluates these; it does not retrieve them."),
      now: z.string().optional().describe("Optional ISO timestamp for deterministic evaluation."),
    }),
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, async ({ profile, intent, signals, now }) => {
    try {
      const result = evaluateContextInput({ profile, intent, signals, now });
      return ok(formatEvaluateContextResult(result));
    } catch (err) {
      if (err instanceof EvaluateContextInputError) {
        return ok(`[FreshContext evaluate_context error]\n${err.message}`);
      }
      return ok(`[FreshContext evaluate_context error]\n${err instanceof Error ? err.message : String(err)}`);
    }
  });

  server.registerTool("extract_github", {
    description: "Extract real-time data from a GitHub repository — README, stars, forks, last commit, topics. Returns timestamped freshcontext.",
    inputSchema: z.object({ url: z.string().url().describe("Full GitHub repo URL e.g. https://github.com/owner/repo") }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ url }) => {
    return withCache("github", url, env.CACHE, ctx, async () => {
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
      } catch (err: unknown) { return adapterError("extract_github", "github", url, err); }
    });
  });

  server.registerTool("extract_hackernews", {
    description: "Extract top stories or search results from Hacker News. The url field accepts an HN/Algolia URL or a plain search query.",
    inputSchema: z.object({ url: z.string().min(1).describe("HN URL e.g. https://news.ycombinator.com/news, Algolia API URL, or search query e.g. 'browser agents'") }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ url }) => {
    return withCache("hackernews", url, env.CACHE, ctx, async () => {
      try {
        let parsedInput: URL | null = null;
        try { parsedInput = new URL(url); } catch { parsedInput = null; }
        if (!parsedInput || url.includes("hn.algolia.com")) {
          let apiUrl: string;
          if (parsedInput && url.includes("/api/")) {
            apiUrl = url;
          } else {
            // Extract ?q= or ?query= param if present — don't encode the whole URL as the query
            let searchTerm: string;
            if (parsedInput) searchTerm = parsedInput.searchParams.get("q") ?? parsedInput.searchParams.get("query") ?? "";
            else searchTerm = url.trim();
            apiUrl = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(searchTerm)}&tags=story&hitsPerPage=20`;
          }
          const res = await sourceFetch(apiUrl, undefined, adapterLog("extract_hackernews", "hackernews", url));
          if (!res.ok) throw new Error(`HN API error: ${res.status}`);
          const json = await res.json() as any;
          const raw = json.hits.map((r: any, i: number) =>
            `[${i+1}] ${r.title}\nURL: ${r.url ?? `https://news.ycombinator.com/item?id=${r.objectID}`}\nScore: ${r.points} | ${r.num_comments} comments\nPosted: ${normalizeHnDate(r.created_at) ?? r.created_at}`
          ).join("\n\n");
          const newest = json.hits.map((r: any) => normalizeHnDate(r.created_at)).filter(Boolean).sort().reverse()[0] ?? null;
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
        const raw = items.map((r, i) => `[${i+1}] ${r.title}\nURL: ${r.link}\nScore: ${r.score ?? "N/A"}\nPosted: ${normalizeHnDate(r.age) ?? "unknown"}`).join("\n\n");
        const newest2 = items.map(r => normalizeHnDate(r.age)).filter(Boolean).sort().reverse()[0] ?? null;
        return ok(stamp(raw, safeUrl, newest2, newest2 ? "high" : "medium", "hackernews"));
      } catch (err: unknown) { return adapterError("extract_hackernews", "hackernews", url, err); }
    });
  });

  server.registerTool("extract_scholar", {
    description: "Extract research results from Google Scholar with publication dates.",
    inputSchema: z.object({ url: z.string().url().describe("Google Scholar search URL") }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ url }) => {
    return withCache("scholar", url, env.CACHE, ctx, async () => {
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
      } catch (err: unknown) { return adapterError("extract_scholar", "google_scholar", url, err); }
    });
  });

  server.registerTool("extract_yc", {
    description: "Scrape YC company listings by keyword. Returns name, batch, tags, description per company.",
    inputSchema: z.object({ url: z.string().url().describe("YC URL e.g. https://www.ycombinator.com/companies?query=mcp") }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ url }) => {
    return withCache("yc", url, env.CACHE, ctx, async () => {
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
        return ok(stamp(raw, safeUrl, new Date().toISOString().slice(0, 10), "medium", "yc"));
      } catch (err: unknown) { return adapterError("extract_yc", "yc", url, err); }
    });
  });

  server.registerTool("search_repos", {
    description: "Search GitHub for repositories matching a keyword. Returns top results by stars.",
    inputSchema: z.object({ query: z.string().describe("Search query e.g. 'mcp server typescript'") }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ query }) => {
    return withCache("reposearch", query, env.CACHE, ctx, async () => {
      try {
        const q = query.replace(/[\x00-\x1F]/g, "").trim().slice(0, 200);
        const ghHeaders: Record<string, string> = { "User-Agent": SERVICE_UA, "Accept": "application/vnd.github+json" };
        if (env.GITHUB_TOKEN) ghHeaders["Authorization"] = `Bearer ${env.GITHUB_TOKEN}`;
        const res = await sourceFetch(`https://api.github.com/search/repositories?q=${encodeURIComponent(q)}&sort=stars&order=desc&per_page=15`, {
          headers: ghHeaders,
        }, adapterLog("search_repos", "reposearch", query));
        if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
        const json = await res.json() as any;
        const raw = json.items.map((r: any, i: number) =>
          `[${i+1}] ${r.full_name}\n⭐ ${r.stargazers_count} stars | ${r.language ?? "N/A"}\n${r.description ?? "No description"}\nUpdated: ${r.updated_at?.slice(0,10)}\nURL: ${r.html_url}`
        ).join("\n\n");
        const newest = json.items.map((r: any) => r.updated_at).filter(Boolean).sort().reverse()[0] ?? null;
        return ok(stamp(raw, `https://github.com/search?q=${encodeURIComponent(q)}`, newest, newest ? "high" : "medium", "reposearch"));
      } catch (err: unknown) { return adapterError("search_repos", "reposearch", query, err); }
    });
  });

  server.registerTool("package_trends", {
    description: "npm and PyPI package metadata — version history, release cadence, last updated.",
    inputSchema: z.object({ packages: z.string().describe("Package name(s) e.g. 'langchain' or 'npm:zod,pypi:fastapi'") }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ packages }) => {
    return withCache("packagetrends", packages, env.CACHE, ctx, async () => {
      try {
        const entries = packages.split(",").map(s => s.trim()).filter(Boolean).slice(0, 5);
        const results: string[] = [];
        for (const entry of entries) {
          const isNpm = !entry.startsWith("pypi:") && (entry.startsWith("npm:") || !entry.includes(":"));
          const name = entry.replace(/^(npm:|pypi:)/, "");
          if (isNpm) {
            const res = await sourceFetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`, undefined, adapterLog("package_trends", "packagetrends", packages));
            if (!res.ok) { results.push(`[npm:${name}] Not found`); continue; }
            const j = await res.json() as any;
            const versions = Object.keys(j.versions ?? {}).slice(-5).reverse();
            results.push(`npm:${name}\nLatest: ${j["dist-tags"]?.latest ?? "N/A"}\nUpdated: ${j.time?.modified?.slice(0,10) ?? "N/A"}\nRecent versions: ${versions.join(", ")}\nDescription: ${j.description ?? "N/A"}`);
          } else {
            const res = await sourceFetch(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`, undefined, adapterLog("package_trends", "packagetrends", packages));
            if (!res.ok) { results.push(`[pypi:${name}] Not found`); continue; }
            const j = await res.json() as any;
            const versions = Object.keys(j.releases ?? {}).slice(-5).reverse();
            results.push(`pypi:${name}\nLatest: ${j.info?.version ?? "N/A"}\nDescription: ${j.info?.summary ?? "N/A"}\nRecent versions: ${versions.join(", ")}`);
          }
        }
        const raw = results.join("\n\n─────────────\n\n");
        return ok(stamp(raw, "package-registries", new Date().toISOString(), "high", "packagetrends"));
      } catch (err: unknown) { return adapterError("package_trends", "packagetrends", packages, err); }
    });
  });

  server.registerTool("extract_reddit", {
    description: "Extract posts and community sentiment from Reddit.",
    inputSchema: z.object({ url: z.string().describe("Subreddit name e.g. 'r/MachineLearning' or search URL") }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ url }) => {
    return withCache("reddit", url, env.CACHE, ctx, async () => {
      try {
        let apiUrl = url;
        if (!apiUrl.startsWith("http")) {
          const clean = apiUrl.replace(/^r\//, "");
          apiUrl = `https://www.reddit.com/r/${clean}/.json?limit=25&sort=hot`;
        }
        if (!apiUrl.includes(".json")) apiUrl = apiUrl.replace(/\/?$/, ".json");
        if (!apiUrl.includes("limit=")) apiUrl += (apiUrl.includes("?") ? "&" : "?") + "limit=25";
        const res = await sourceFetch(apiUrl, { headers: { "User-Agent": SERVICE_UA, "Accept": "application/json" } }, adapterLog("extract_reddit", "reddit", url));
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
      } catch (err: unknown) { return adapterError("extract_reddit", "reddit", url, err); }
    });
  });

  server.registerTool("extract_producthunt", {
    description: "Recent Product Hunt launches by keyword or topic.",
    inputSchema: z.object({ url: z.string().describe("Search query or PH topic URL") }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ url }) => {
    return withCache("producthunt", url, env.CACHE, ctx, async () => {
      try {
        const isUrl = url.startsWith("http");
        const gql = `{ posts(first: 20, order: VOTES${isUrl ? "" : `, search: ${JSON.stringify(url)}`}) { edges { node { name tagline url votesCount commentsCount createdAt topics { edges { node { name } } } } } } }`;
        const res = await sourceFetch("https://api.producthunt.com/v2/api/graphql", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${env.PH_TOKEN ?? ""}` },
          body: JSON.stringify({ query: gql }),
        }, adapterLog("extract_producthunt", "producthunt", url));
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
      } catch (err: unknown) { return adapterError("extract_producthunt", "producthunt", url, err); }
    });
  });

  server.registerTool("extract_finance", {
    description: "No-key stock quote data via Stooq. Accepts comma-separated ticker symbols and returns quote/OHLC/volume observations with timestamps.",
    inputSchema: z.object({ url: z.string().describe("Ticker symbol(s) e.g. 'AAPL' or 'MSFT,GOOG'") }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ url }) => {
    return withCache("finance", url, env.CACHE, ctx, async () => {
      try {
        const r = await fetchFinance(url, 5000, adapterLog("extract_finance", "finance", url));
        return ok(stamp(r.raw, `stooq:${url}`, r.date, r.conf, "finance"));
      } catch (err: unknown) { return adapterError("extract_finance", "finance", url, err); }
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
    return withCache("jobs", query, env.CACHE, ctx, async () => {
      try {
        const q = query.replace(/[\x00-\x1F]/g, "").trim().slice(0, 200);
        const perSource = Math.floor((max_length ?? 6000) / 2);
        const [remotiveRes, hnRes] = await Promise.allSettled([
          sourceFetch(`https://remotive.com/api/remote-jobs?search=${encodeURIComponent(q)}&limit=10`, { headers: { "User-Agent": SERVICE_UA, "Accept": "application/json" } }, adapterLog("search_jobs", "jobs", query)).then(r => r.json()),
          sourceFetch(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q + " hiring")}&tags=comment&hitsPerPage=8`, undefined, adapterLog("search_jobs", "hackernews", query)).then(r => r.json()),
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
      } catch (err: unknown) { return adapterError("search_jobs", "jobs", query, err); }
    });
  });

  server.registerTool("extract_landscape", {
    description: "Composite tool. Queries YC + GitHub + HN + npm simultaneously. Returns a unified timestamped landscape report.",
    inputSchema: z.object({ topic: z.string().describe("Project idea or keyword e.g. 'mcp server'") }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ topic }) => {
    return withCache("landscape", topic, env.CACHE, ctx, async () => {
      try {
        const t = topic.replace(/[\x00-\x1F]/g, "").trim().slice(0, 200);
        const [hn, repos, pkg] = await Promise.allSettled([
          sourceFetch(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(t)}&tags=story&hitsPerPage=10`, undefined, adapterLog("extract_landscape", "hackernews", topic)).then(r => r.json()),
          sourceFetch(`https://api.github.com/search/repositories?q=${encodeURIComponent(t)}&sort=stars&per_page=8`, { headers: { "User-Agent": SERVICE_UA } }, adapterLog("extract_landscape", "reposearch", topic)).then(r => r.json()),
          sourceFetch(`https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(t)}&size=5`, undefined, adapterLog("extract_landscape", "packagetrends", topic)).then(r => r.json()),
        ]);
        if (hn.status === "rejected") logEvent("adapter_error", adapterLog("extract_landscape", "hackernews", topic), hn.reason);
        if (repos.status === "rejected") logEvent("adapter_error", adapterLog("extract_landscape", "reposearch", topic), repos.reason);
        if (pkg.status === "rejected") logEvent("adapter_error", adapterLog("extract_landscape", "packagetrends", topic), pkg.reason);
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
        return ok(stamp(sections, `freshcontext:landscape:${t}`, new Date().toISOString().slice(0,10), "medium", "landscape"));
      } catch (err: unknown) { return adapterError("extract_landscape", "landscape", topic, err); }
    });
  });

  // ─── Tool: extract_arxiv ────────────────────────────────────────────────
  server.registerTool("extract_arxiv", {
    description: "Search arXiv for research papers via the official API. Pass a topic or full arXiv API URL. Returns titles, authors, dates, abstracts.",
    inputSchema: z.object({ url: z.string().describe("Search query e.g. 'temporal retrieval', or a full arXiv API URL") }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ url }) => {
    return withCache("arxiv", url, env.CACHE, ctx, async () => {
      try {
        const r = await fetchArxiv(url, 6000, adapterLog("extract_arxiv", "arxiv", url));
        const source = url.startsWith("http") ? url : `arxiv:${url}`;
        return ok(stamp(r.raw, source, r.date, r.conf, "arxiv"));
      } catch (err: unknown) { return adapterError("extract_arxiv", "arxiv", url, err); }
    });
  });

  // ─── Tool: extract_changelog ────────────────────────────────────────────
  server.registerTool("extract_changelog", {
    description: "Update history for any product. Accepts a GitHub repo URL or an npm package name. Returns version numbers, release dates, and entries.",
    inputSchema: z.object({ url: z.string().describe("GitHub repo URL or npm package name e.g. 'react'") }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ url }) => {
    return withCache("changelog", url, env.CACHE, ctx, async () => {
      try {
        const r = await fetchChangelog(url, 6000, adapterLog("extract_changelog", "changelog", url));
        return ok(stamp(r.raw, `changelog:${url}`, r.date, r.conf, "changelog"));
      } catch (err: unknown) { return adapterError("extract_changelog", "changelog", url, err); }
    });
  });

  // ─── Tool: extract_gdelt ────────────────────────────────────────────────
  server.registerTool("extract_gdelt", {
    description: "Global news intelligence from GDELT. Monitors news from every country in 100+ languages, updated every 15 minutes. Returns articles with source country, language, date.",
    inputSchema: z.object({ url: z.string().describe("Query: company name, topic, or keyword") }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ url }) => {
    return withCache("gdelt", url, env.CACHE, ctx, async () => {
      try {
        const r = await fetchGdelt(url, 6000, adapterLog("extract_gdelt", "gdelt", url));
        return ok(stamp(r.raw, `gdelt:${url}`, r.date, r.conf, "gdelt"));
      } catch (err: unknown) { return adapterError("extract_gdelt", "gdelt", url, err); }
    });
  });

  // ─── Tool: extract_gebiz ────────────────────────────────────────────────
  server.registerTool("extract_gebiz", {
    description: "Singapore Government procurement opportunities (GeBIZ via data.gov.sg). Search by keyword, agency name, or empty for all recent tenders.",
    inputSchema: z.object({ url: z.string().describe("Keyword, agency, or empty for latest tenders") }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ url }) => {
    return withCache("gebiz", url, env.CACHE, ctx, async () => {
      try {
        const r = await fetchGebiz(url, 6000, adapterLog("extract_gebiz", "gebiz", url));
        return ok(stamp(r.raw, `gebiz:${url || "all"}`, r.date, r.conf, "gebiz"));
      } catch (err: unknown) { return adapterError("extract_gebiz", "gebiz", url, err); }
    });
  });

  // ─── Tool: extract_govcontracts ─────────────────────────────────────────
  server.registerTool("extract_govcontracts", {
    description: "US federal contract awards from USASpending.gov. Search by company name (e.g. 'Palantir'), keyword, or NAICS code. Returns amounts, dates, agencies.",
    inputSchema: z.object({ url: z.string().describe("Company name, keyword, or NAICS code") }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ url }) => {
    return withCache("govcontracts", url, env.CACHE, ctx, async () => {
      try {
        const r = await fetchGovContracts(url, 6000, adapterLog("extract_govcontracts", "govcontracts", url));
        return ok(stamp(r.raw, `govcontracts:${url}`, r.date, r.conf, "govcontracts"));
      } catch (err: unknown) { return adapterError("extract_govcontracts", "govcontracts", url, err); }
    });
  });

  // ─── Tool: extract_sec_filings ──────────────────────────────────────────
  server.registerTool("extract_sec_filings", {
    description: "SEC 8-K filings via EDGAR full-text search. 8-K = legally mandated material event disclosures (CEO changes, M&A, breaches). Pass company name, ticker, or keyword.",
    inputSchema: z.object({ url: z.string().describe("Company name, ticker, or keyword") }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ url }) => {
    return withCache("sec_filings", url, env.CACHE, ctx, async () => {
      try {
        const r = await fetchSecFilings(url, 6000, adapterLog("extract_sec_filings", "sec_filings", url));
        return ok(stamp(r.raw, `sec:${url}`, r.date, r.conf, "sec_filings"));
      } catch (err: unknown) { return adapterError("extract_sec_filings", "sec_filings", url, err); }
    });
  });

  // ─── Composite section helper ───────────────────────────────────────────
  // Wraps each Promise.allSettled result into a "## label\n<content>" section,
  // surfacing partial failures rather than collapsing the whole call.
  const section = (
    label: string,
    r: PromiseSettledResult<AdapterHit>,
    tool?: string,
    adapter?: string,
    input?: unknown
  ): string => {
    if (r.status !== "fulfilled") {
      if (tool && adapter) logEvent("adapter_error", adapterLog(tool, adapter, input), r.reason);
      const reason = r.reason instanceof Error ? r.reason.message : String(r.reason);
      return `## ${label}\n[Unavailable: ${reason}]`;
    }
    return `## ${label}\n${r.value.raw}`;
  };
  const logRejectedSection = (
    tool: string,
    adapter: string,
    input: unknown,
    r: PromiseSettledResult<AdapterHit>
  ): void => {
    if (r.status === "rejected") {
      logEvent("adapter_error", adapterLog(tool, adapter, input), r.reason);
    }
  };

  // ─── Tool: extract_gov_landscape ────────────────────────────────────────
  server.registerTool("extract_gov_landscape", {
    description: "Composite government intelligence: federal contract awards (USASpending) + dev community awareness (HN) + GitHub repo activity + product release velocity (changelog). 4-source unified report.",
    inputSchema: z.object({
      query: z.string().describe("Company name, keyword, or NAICS code"),
      github_url: z.string().optional().describe("Optional GitHub repo URL for the company"),
    }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ query, github_url }) => {
    return withCache("gov_landscape", { query, github_url: github_url ?? null }, env.CACHE, ctx, async () => {
      const per = 3000;
      const repoQuery = github_url ?? query;
      const [contracts, hn, repos, changelog] = await Promise.allSettled([
        fetchGovContracts(query, per, adapterLog("extract_gov_landscape", "govcontracts", query)),
        fetchHN(query, per, adapterLog("extract_gov_landscape", "hackernews", query)),
        fetchRepoSearch(repoQuery, per, env.GITHUB_TOKEN, adapterLog("extract_gov_landscape", "reposearch", repoQuery)),
        fetchChangelog(repoQuery, per, adapterLog("extract_gov_landscape", "changelog", repoQuery)),
      ]);
      logRejectedSection("extract_gov_landscape", "govcontracts", query, contracts);
      logRejectedSection("extract_gov_landscape", "hackernews", query, hn);
      logRejectedSection("extract_gov_landscape", "reposearch", repoQuery, repos);
      logRejectedSection("extract_gov_landscape", "changelog", repoQuery, changelog);
      const body = [
        `# Government Intelligence Landscape: "${query}"`,
        `Generated: ${new Date().toISOString()}`,
        `Sources: USASpending.gov · Hacker News · GitHub · Changelog`,
        "",
        section("🏛️ Federal Contract Awards", contracts),
        section("💬 Developer Community Awareness (Hacker News)", hn),
        section("📦 GitHub Repository Activity", repos),
        section("🔄 Product Release Velocity (Changelog)", changelog),
      ].join("\n\n");
      return ok(stamp(body, `gov_landscape:${query}`, new Date().toISOString(), "high", "gov_landscape"));
    });
  });

  // ─── Tool: extract_finance_landscape ────────────────────────────────────
  server.registerTool("extract_finance_landscape", {
    description: "Composite financial intelligence: Stooq quote data + HN sentiment + Reddit discussion + GitHub ecosystem + product changelog. 5-source unified report.",
    inputSchema: z.object({
      tickers: z.string().describe("One or more ticker symbols e.g. 'PLTR' or 'PLTR,MSFT'"),
      company_name: z.string().optional().describe("Company name for HN/Reddit/GitHub searches"),
      github_query: z.string().optional().describe("GitHub search query or repo URL"),
    }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ tickers, company_name, github_query }) => {
    return withCache("finance_landscape", { tickers, company_name: company_name ?? null, github_query: github_query ?? null }, env.CACHE, ctx, async () => {
      const per = 2400;
      const searchTerm = company_name ?? tickers.split(",")[0].trim();
      const repoQuery = github_query ?? searchTerm;
      const [price, hn, reddit, repos, changelog] = await Promise.allSettled([
        fetchFinance(tickers, per, adapterLog("extract_finance_landscape", "finance", tickers)),
        fetchHN(searchTerm, per, adapterLog("extract_finance_landscape", "hackernews", searchTerm)),
        fetchReddit(searchTerm, per, adapterLog("extract_finance_landscape", "reddit", searchTerm)),
        fetchRepoSearch(repoQuery, per, env.GITHUB_TOKEN, adapterLog("extract_finance_landscape", "reposearch", repoQuery)),
        fetchChangelog(repoQuery, per, adapterLog("extract_finance_landscape", "changelog", repoQuery)),
      ]);
      logRejectedSection("extract_finance_landscape", "finance", tickers, price);
      logRejectedSection("extract_finance_landscape", "hackernews", searchTerm, hn);
      logRejectedSection("extract_finance_landscape", "reddit", searchTerm, reddit);
      logRejectedSection("extract_finance_landscape", "reposearch", repoQuery, repos);
      logRejectedSection("extract_finance_landscape", "changelog", repoQuery, changelog);
      const body = [
        `# Finance + Developer Intelligence: "${tickers}"${company_name ? ` (${company_name})` : ""}`,
        `Generated: ${new Date().toISOString()}`,
        `Sources: Stooq · Hacker News · Reddit · GitHub · Changelog`,
        "",
        section("📈 Market Data (Stooq)", price),
        section("💬 Developer Sentiment (Hacker News)", hn),
        section("🗣️ Community Discussion (Reddit)", reddit),
        section("📦 Repo Ecosystem (GitHub)", repos),
        section("🔄 Product Release Velocity (Changelog)", changelog),
      ].join("\n\n");
      return ok(stamp(body, `finance_landscape:${tickers}`, new Date().toISOString(), "high", "finance_landscape"));
    });
  });

  // ─── Tool: extract_company_landscape ────────────────────────────────────
  server.registerTool("extract_company_landscape", {
    description: "Most complete single-call company intelligence: SEC 8-K filings + USASpending federal contracts + GDELT global news + product changelog + Stooq quote data. 5 unique sources.",
    inputSchema: z.object({
      company: z.string().describe("Company name e.g. 'Palantir', 'Anthropic'"),
      ticker: z.string().optional().describe("Stock ticker for finance data"),
      github_url: z.string().optional().describe("Optional GitHub repo or org URL for changelog accuracy"),
    }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ company, ticker, github_url }) => {
    return withCache("company_landscape", { company, ticker: ticker ?? null, github_url: github_url ?? null }, env.CACHE, ctx, async () => {
      const per = 3000;
      const repoQuery = github_url ?? company;
      const [sec, contracts, gdelt, changelog, finance] = await Promise.allSettled([
        fetchSecFilings(company, per, adapterLog("extract_company_landscape", "sec_filings", company)),
        fetchGovContracts(company, per, adapterLog("extract_company_landscape", "govcontracts", company)),
        fetchGdelt(company, per, adapterLog("extract_company_landscape", "gdelt", company)),
        fetchChangelog(repoQuery, per, adapterLog("extract_company_landscape", "changelog", repoQuery)),
        fetchFinance(ticker ?? company, per, adapterLog("extract_company_landscape", "finance", ticker ?? company)),
      ]);
      logRejectedSection("extract_company_landscape", "sec_filings", company, sec);
      logRejectedSection("extract_company_landscape", "govcontracts", company, contracts);
      logRejectedSection("extract_company_landscape", "gdelt", company, gdelt);
      logRejectedSection("extract_company_landscape", "changelog", repoQuery, changelog);
      logRejectedSection("extract_company_landscape", "finance", ticker ?? company, finance);
      const body = [
        `# Company Intelligence Landscape: "${company}"${ticker ? ` (${ticker})` : ""}`,
        `Generated: ${new Date().toISOString()}`,
        `Sources: SEC EDGAR · USASpending.gov · GDELT · Changelog · Stooq`,
        "",
        section("📋 SEC 8-K Filings — Legal Disclosures", sec),
        section("🏛️ Federal Contract Awards", contracts),
        section("🌍 Global News Intelligence (GDELT)", gdelt),
        section("🔄 Product Release Velocity (Changelog)", changelog),
        section("📈 Market Data (Stooq)", finance),
      ].join("\n\n");
      return ok(stamp(body, `company_landscape:${company}`, new Date().toISOString(), "high", "company_landscape"));
    });
  });

  // ─── Tool: extract_idea_landscape ───────────────────────────────────────
  server.registerTool("extract_idea_landscape", {
    description: "Idea validation composite: HN pain signals + YC funded competitors + GitHub crowding + jobs market signal + npm/PyPI ecosystem + Product Hunt launches. 6 sources.",
    inputSchema: z.object({
      idea: z.string().describe("Your idea, problem space, or keyword"),
    }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, async ({ idea }) => {
    return withCache("idea_landscape", idea, env.CACHE, ctx, async () => {
      const per = 2200;
      const [hn, yc, repos, jobs, pkg, ph] = await Promise.allSettled([
        fetchHN(idea, per, adapterLog("extract_idea_landscape", "hackernews", idea)),
        fetchYC(idea, per, adapterLog("extract_idea_landscape", "yc", idea)),
        fetchRepoSearch(idea, per, env.GITHUB_TOKEN, adapterLog("extract_idea_landscape", "reposearch", idea)),
        fetchJobs(idea, per, adapterLog("extract_idea_landscape", "jobs", idea)),
        fetchPackageTrends(idea, per, adapterLog("extract_idea_landscape", "packagetrends", idea)),
        fetchProductHunt(idea, per, env.PH_TOKEN, adapterLog("extract_idea_landscape", "producthunt", idea)),
      ]);
      logRejectedSection("extract_idea_landscape", "hackernews", idea, hn);
      logRejectedSection("extract_idea_landscape", "yc", idea, yc);
      logRejectedSection("extract_idea_landscape", "reposearch", idea, repos);
      logRejectedSection("extract_idea_landscape", "jobs", idea, jobs);
      logRejectedSection("extract_idea_landscape", "packagetrends", idea, pkg);
      logRejectedSection("extract_idea_landscape", "producthunt", idea, ph);
      const body = [
        `# Idea Validation Landscape: "${idea}"`,
        `Generated: ${new Date().toISOString()}`,
        `Sources: Hacker News · YC · GitHub · Jobs · npm/PyPI · Product Hunt`,
        "",
        `## ℹ️ How to read this report`,
        `Pain (HN) · Funding (YC) · Crowding (GitHub) · Market (Jobs) · Ecosystem (Packages) · Launches (PH)`,
        "",
        section("🗣️ Pain Signal — HN Discussions", hn),
        section("💰 Funding Signal — YC Companies", yc),
        section("📦 Crowding Signal — GitHub Repos", repos),
        section("💼 Market Signal — Job Listings", jobs),
        section("🔧 Ecosystem Signal — Packages", pkg),
        section("🚀 Launch Signal — Product Hunt", ph),
      ].join("\n\n");
      return ok(stamp(body, `idea_landscape:${idea}`, new Date().toISOString(), "high", "idea_landscape"));
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

async function runAdapter(adapter: string, query: string, filters: Record<string, any>, env?: Env, log: LogFields = {}): Promise<string> {
  switch (adapter) {
    case "jobs": {
      const url = `https://remotive.com/api/remote-jobs?search=${encodeURIComponent(query)}&limit=10`;
      const res = await sourceFetch(url, { headers: { "User-Agent": "freshcontext-mcp/cron", "Accept": "application/json" } }, { ...log, adapter: "jobs" });
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
      const res = await sourceFetch(url, { headers: { "User-Agent": "freshcontext-mcp/cron" } }, { ...log, adapter: "hackernews" });
      const data = await res.json() as any;
      return sanitize(data.hits?.map((h: any) => `${h.title} | score:${h.points} | ${h.created_at}`).join("\n") ?? "");
    }
    case "reposearch": {
      const headers: Record<string, string> = { "User-Agent": "freshcontext-mcp/cron", "Accept": "application/vnd.github.v3+json" };
      if (env?.GITHUB_TOKEN) headers["Authorization"] = `Bearer ${env.GITHUB_TOKEN}`;
      const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}&sort=stars&per_page=10`;
      const res = await sourceFetch(url, { headers }, { ...log, adapter: "reposearch" });
      const data = await res.json() as any;
      return sanitize(data.items?.map((r: any) => `${r.full_name} | stars:${r.stargazers_count} | updated:${r.updated_at?.slice(0,10)} | ${r.description ?? ""}`).join("\n") ?? "");
    }
    case "github": {
      const match = query.match(/github\.com\/([^/]+\/[^/]+)/);
      if (!match) return "";
      const repoSlug = match[1].replace(/\.git$/, "").split("/").slice(0, 2).join("/");
      const ghHeaders: Record<string, string> = { "User-Agent": "freshcontext-mcp/cron", "Accept": "application/vnd.github.v3+json" };
      if (env?.GITHUB_TOKEN) ghHeaders["Authorization"] = `Bearer ${env.GITHUB_TOKEN}`;
      const res = await sourceFetch(`https://api.github.com/repos/${repoSlug}`, { headers: ghHeaders }, { ...log, adapter: "github" });
      if (!res.ok) return `GitHub error ${res.status} for ${repoSlug}`;
      const data = await res.json() as any;
      if (data.message) return sanitize(`GitHub: ${data.message}`);
      return sanitize(`Stars:${data.stargazers_count} Forks:${data.forks_count} Updated:${data.updated_at} Issues:${data.open_issues_count} Lang:${data.language ?? "N/A"} Description:${data.description ?? ""}`);
    }
    case "finance": {
      const r = await fetchFinance(query, 1200, { ...log, adapter: "finance" });
      return sanitize(r.raw);
    }
    case "reddit": {
      const sub = query.match(/r\/(\w+)/)?.[1];
      const term = query.replace(/r\/\w+\s*/, "").trim();
      const url = sub && term
        ? `https://www.reddit.com/r/${sub}/search.json?q=${encodeURIComponent(term)}&sort=new&limit=10&restrict_sr=1`
        : sub
          ? `https://www.reddit.com/r/${sub}/new.json?limit=10`
          : `https://www.reddit.com/search.json?q=${encodeURIComponent(query)}&sort=new&limit=10`;
      const res = await sourceFetch(url, { headers: { "User-Agent": "freshcontext-mcp/cron" } }, { ...log, adapter: "reddit" });
      if (!res.ok) return `Reddit error ${res.status}`;
      const data = await res.json() as any;
      return sanitize((data?.data?.children ?? []).map((p: any) =>
        `${p.data.title} | score:${p.data.score} | ${new Date(p.data.created_utc * 1000).toISOString()}`
      ).join("\n"));
    }
    case "yc": {
      const res = await sourceFetch("https://yc-oss.github.io/api/companies/all.json", { headers: { "User-Agent": "freshcontext-mcp/cron" } }, { ...log, adapter: "yc" });
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
        sourceFetch(`https://registry.npmjs.org/${pkg}`, { headers: { "User-Agent": "freshcontext-mcp/cron" } }, { ...log, adapter: "packagetrends" }),
        sourceFetch(`https://api.npmjs.org/downloads/point/last-month/${pkg}`, { headers: { "User-Agent": "freshcontext-mcp/cron" } }, { ...log, adapter: "packagetrends" }),
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

async function runScheduledScrape(env: Env, log: LogFields = {}): Promise<void> {
  // ── Schema migrations (idempotent) ───────────────────────────────────────
  // Schema migrations — single source of truth in ensureMigrations.
  // Idempotent and cheap after first call (promise-gated).
  await ensureMigrations(env);

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
      const raw = await runAdapter(wq.adapter, wq.query, filters, env, {
        ...log,
        adapter: wq.adapter,
        watched_query_id: wq.id,
        input_hash: hashInput(wq.query),
      });
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
           semantic_fingerprint, is_expired)
        VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        resultId, wq.id, wq.adapter, wq.query, raw.slice(0, 8000), hash,
        scored.relevancy_score, scored.is_relevant,
        scored.base_score, scored.rt_score, scored.ha_pri_sig,
        scored.entropy_level, scored.published_at,
        fingerprint, scored.is_expired
      ).run();

      console.log(`[DAR] ${wq.adapter}/${wq.query.slice(0,28)} R0:${scored.base_score} Rt:${scored.rt_score} entropy:${scored.entropy_level} sig:${scored.ha_pri_sig.slice(0,8)}`);

      await env.DB.prepare(`UPDATE watched_queries SET last_run_at = datetime('now') WHERE id = ?`).bind(wq.id).run();

      // Only count as "new signal" if above the noise floor
      return scored.is_relevant === 1 ? wq.adapter : null;
    } catch (err: unknown) {
      logEvent("cron_error", {
        ...log,
        adapter: wq.adapter,
        watched_query_id: wq.id,
        input_hash: hashInput(wq.query),
        phase: "scrape_one",
      }, err);
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

const BLOCKED_PATH_PATTERNS = [
  /^\/wp-/,
  /^\/wordpress/,
  /^\/admin/,
  /^\/administrator/,
  /^\/phpmyadmin/,
  /^\/xmlrpc\.php/,
  /^\/\.env/,
  /^\/\.git/,
  /^\/\.aws/,
  /^\/\.ssh/,
  /^\/cgi-bin/,
  /^\/HNAP1/,
  /\.php$/,
  /\.asp$/i,
  /\.aspx$/i,
  /\.jsp$/i,
  /^\/owa\//,
  /^\/ecp\//,
  /^\/_ignition/,
];

const BLOCKED_USER_AGENTS = [
  "masscan", "nmap", "sqlmap", "nikto", "gobuster", "dirbuster",
  "metasploit", "hydra", "havij", "acunetix", "nessus", "openvas",
  "zgrab", "shodan", "censys", "l9scan", "l9explore",
];

function isBotProbe(url: URL, ua: string): boolean {
  for (const p of BLOCKED_PATH_PATTERNS) {
    if (p.test(url.pathname)) return true;
  }
  if (ua) {
    const uaLower = ua.toLowerCase();
    for (const bad of BLOCKED_USER_AGENTS) {
      if (uaLower.includes(bad)) return true;
    }
  }
  return false;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const ua = request.headers.get("User-Agent") ?? "";
    const requestLog: LogFields = {
      request_id: crypto.randomUUID(),
      route: routeName(url.pathname),
      method: request.method,
      path: url.pathname,
    };
    const routeError = (err: unknown, status = 500): Response => {
      logEvent("route_error", { ...requestLog, status }, err);
      return errResponse(err instanceof Error ? err.message : String(err), status);
    };

    // Bot probe filter — cheapest reject path, runs first
    if (isBotProbe(url, ua)) {
      return new Response("Gone", { status: 410 });
    }

    if (!isAllowedRoute(url.pathname)) {
      return errResponse(`Not found: ${url.pathname}. See GET / for endpoint list.`, 404);
    }

    // ── GET /demo — static demo page (HTML + data.json) ─────────────────
    // Demo files live in /demo at repo root, mounted via the ASSETS binding.
    // Force trailing slash so relative `./data.json` fetches from the HTML
    // resolve correctly to /demo/data.json (not /data.json).
    if (url.pathname === "/demo") {
      return Response.redirect(url.origin + "/demo/" + url.search, 301);
    }
    if (url.pathname.startsWith("/demo/")) {
      // Strip the /demo/ prefix so the asset directory roots at the URL path
      // (`/demo/index.html` → `index.html` in the asset bundle).
      const stripped = url.pathname.replace(/^\/demo\//, "/");
      const assetUrl = new URL(stripped + url.search, url.origin);
      return env.ASSETS.fetch(new Request(assetUrl, request));
    }

    // ── GET /health — cheap liveness check for monitoring ───────────────────────
    if (url.pathname === "/health") {
      const methodError = requireMethod(request, ["GET", "HEAD"]);
      if (methodError) return methodError;
      const health = {
        status: "ok",
        service: "freshcontext-mcp",
        version: SERVICE_VERSION,
        time: new Date().toISOString(),
      };
      if (request.method === "HEAD") {
        return new Response(null, { headers: { "Content-Type": "application/json" } });
      }
      return jsonResponse(health);
    }

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
      } catch (err: unknown) { return routeError(err); }
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
      } catch (err: unknown) { return routeError(err); }
    }

    // ── GET /v1/intel/feed/:profile_id — structured intelligence feed ─────────
    // Returns top signals ranked by Rt score, formatted for agent consumption.
    //
    // Lazy decay: rt_score is recomputed from base_score, published_at, and
    // adapter λ at request time, NOT read from the cron-written column.
    // The stored rt_score in scrape_results is a historical record (value-at-
    // write-time); the served value is always fresh as of NOW. This eliminates
    // up-to-6h staleness between cron runs and prevents "frozen" signals.
    if (url.pathname.startsWith("/v1/intel/feed/")) {
      try { checkAuth(request, env); } catch (e: any) { return errResponse(e.message, 401); }
      const profileId = url.pathname.split("/").pop() ?? "default";
      const limit = parseInt(url.searchParams.get("limit") ?? "20");
      const minRt = parseFloat(url.searchParams.get("min_rt") ?? "0");

      try {
        // Make sure schema is current before querying. Promise-gated, O(1) after
        // first call per isolate. Eliminates deploy-then-cron race condition.
        await ensureMigrations(env);

        // Over-fetch (3x) so we still return `limit` after expiry/floor filtering.
        // Cap at 200 to bound D1 cost.
        const overFetch = Math.min(200, Math.max(limit * 3, limit));

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
            AND (sr.is_expired IS NULL OR sr.is_expired = 0)
          ORDER BY COALESCE(sr.rt_score, sr.relevancy_score, 0) DESC
          LIMIT ?
        `).bind(profileId, overFetch).all<{
          id: string; adapter: string; query: string; raw_content: string;
          scraped_at: string; published_at: string | null;
          base_score: number | null; rt_score: number | null;
          ha_pri_sig: string | null; entropy_level: string | null;
          label: string | null;
        }>();

        // Recompute Rt fresh per row using stored base_score + published_at.
        // Filter out expired (Rt < RT_EXPIRY_FLOOR) and below user-supplied min_rt.
        // Re-sort by fresh Rt, then take top `limit`.
        const refreshed = signals
          .map(s => {
            const decayed = applyDecay(s.base_score ?? 0, s.published_at, s.adapter);
            return { row: s, fresh_rt: decayed.rt, fresh_entropy: decayed.entropy, fresh_expired: decayed.is_expired };
          })
          .filter(r => !r.fresh_expired && r.fresh_rt >= minRt)
          .sort((a, b) => b.fresh_rt - a.fresh_rt)
          .slice(0, limit);

        const feed = {
          feed_metadata: {
            profile_id: profileId,
            generated_at: new Date().toISOString(),
            signal_count: refreshed.length,
            version: "freshcontext-1.2",
            decay_mode: "lazy", // computed at read time, not cron time
          },
          signals: refreshed.map(r => ({
            signal_id: r.row.id,
            source: r.row.adapter,
            label: r.row.label ?? r.row.query,
            content: {
              preview: r.row.raw_content.slice(0, 400),
              url: r.row.query,
            },
            intelligence_stamps: {
              scraped_at: r.row.scraped_at,
              published_at: r.row.published_at ?? null,
              base_score: r.row.base_score ?? null,
              rt_score: r.fresh_rt,
              rt_score_at_write: r.row.rt_score ?? null, // historical, for diagnostics
              entropy_level: r.fresh_entropy,
              is_expired: false, // filtered out above
              ha_pri_sig: r.row.ha_pri_sig ?? null,
            },
          })),
        };

        return new Response(JSON.stringify(feed), {
          headers: { "Content-Type": "application/json" },
        });
      } catch (err: unknown) { return routeError(err); }
    }

    // ── DEBUG endpoints ───────────────────────────────────────────────────────

    if (url.pathname === "/debug/scrape") {
      const methodError = requireMethod(request, ["GET"]);
      if (methodError) return methodError;
      try { checkAuth(request, env); } catch (e: any) { return errResponse(e.message, 401); }
      const adapter = url.searchParams.get("adapter") ?? "hackernews";
      const query   = url.searchParams.get("query")   ?? "mcp server";
      try {
        const raw = await runAdapter(adapter, query, {}, env, { ...requestLog, adapter, input_hash: hashInput(query) });
        return jsonResponse({ adapter, query, raw, length: raw.length });
      } catch (err: unknown) {
        logEvent("route_error", { ...requestLog, adapter, input_hash: hashInput(query), status: 500 }, err);
        return jsonResponse({ adapter, error: "Debug scrape failed." }, 500);
      }
    }

    if (url.pathname === "/debug/db") {
      const methodError = requireMethod(request, ["GET"]);
      if (methodError) return methodError;
      try { checkAuth(request, env); } catch (e: any) { return errResponse(e.message, 401); }
      try {
      const [wq, sr, br, up, scored, dedupe] = await Promise.all([
        env.DB.prepare("SELECT COUNT(*) as n FROM watched_queries").first<{n:number}>(),
        env.DB.prepare("SELECT COUNT(*) as n FROM scrape_results").first<{n:number}>(),
        env.DB.prepare("SELECT COUNT(*) as n FROM briefings").first<{n:number}>(),
        env.DB.prepare("SELECT COUNT(*) as n FROM user_profiles").first<{n:number}>(),
        env.DB.prepare("SELECT COUNT(*) as n FROM scrape_results WHERE rt_score IS NOT NULL").first<{n:number}>(),
        env.DB.prepare("SELECT COUNT(DISTINCT semantic_fingerprint) as n FROM scrape_results WHERE semantic_fingerprint IS NOT NULL").first<{n:number}>(),
      ]);
      const { results: recent } = await env.DB.prepare(
        `SELECT adapter, query, rt_score, base_score, entropy_level,
                substr(ha_pri_sig, 1, 12) as ha_pri_sig_short,
                substr(semantic_fingerprint, 1, 12) as fp_short,
                published_at, scraped_at
         FROM scrape_results ORDER BY scraped_at DESC LIMIT 5`
      ).all();
      return new Response(JSON.stringify({
        counts: {
          watched_queries: wq?.n,
          scrape_results: sr?.n,
          briefings: br?.n,
          user_profiles: up?.n,
        },
        dar_engine: {
          signals_scored: scored?.n,
          unique_fingerprints: dedupe?.n,
          scoring_coverage: sr?.n ? `${Math.round(100 * (scored?.n ?? 0) / sr.n)}%` : "0%",
        },
        recent_signals: recent,
      }, null, 2), { headers: { "Content-Type": "application/json" } });
      } catch (err: unknown) { return routeError(err); }
    }

    // ── POST /briefing/now — force synthesis ──────────────────────────────────
    if (url.pathname === "/briefing/now" && request.method === "POST") {
      try { checkAuth(request, env); } catch (e: any) { return errResponse(e.message, 401); }
      try {
        await runScheduledScrape(env, { ...requestLog, phase: "manual_briefing_now" });
        // Use Claude synthesis if key is set, fallback to local formatter
        let briefingText: string;
        if (env.ANTHROPIC_KEY) {
          const aiResult = await generateAIBriefing(env.DB, env.ANTHROPIC_KEY);
          briefingText = aiResult?.summary ?? await formatBriefing(env.DB);
        } else {
          briefingText = await formatBriefing(env.DB);
        }
        return new Response(JSON.stringify({ briefing: briefingText }), { headers: { "Content-Type": "application/json" } });
      } catch (err: unknown) { return routeError(err); }
    }

    // ── GET / — landing page, stops bots from triggering errors ──────────────────
    if (url.pathname === "/" || url.pathname === "") {
      return new Response(JSON.stringify({
        service: "freshcontext-mcp",
        version: SERVICE_VERSION,
        description: "FreshContext - context integrity infrastructure for AI agents and retrieval systems",
        endpoints: {
          mcp: "POST /mcp  (JSON-RPC 2.0)",
          briefing: "GET /briefing",
          briefing_now: "POST /briefing/now",
          intel_feed: "GET /v1/intel/feed/:profile_id?limit=20&min_rt=0",
          watched_queries: "GET /watched-queries",
          debug_db: "GET /debug/db",
          debug_scrape: "GET /debug/scrape?adapter=X&query=Y",
        },
        docs: "https://freshcontext-site.pages.dev",
        spec: "https://freshcontext-site.pages.dev/spec.html",
        github: "https://github.com/PrinceGabriel-lgtm/freshcontext-mcp",
      }, null, 2), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // ── Reject non-MCP paths cleanly before transport (reduces bot-error noise) ──
    if (url.pathname !== "/mcp" && url.pathname !== "/mcp/") {
      return errResponse(`Not found: ${url.pathname}. See GET / for endpoint list.`, 404);
    }

    // ── MCP transport (only /mcp reaches here) ───────────────────────────────────────
    // /mcp is the public interface — read-only, cached, rate-limited.
    // Auth is NOT enforced here so MCP marketplace probes (AgenticMarket,
    // MCP Registry health checks) can verify the endpoint speaks MCP.
    // Authenticated endpoints that touch private D1 data keep auth.

    // OPTIONS preflight — must return before rate limit so CORS probes never hang.
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Accept, Authorization, Mcp-Session-Id",
          "Access-Control-Max-Age": "86400",
        },
      });
    }

    // Only GET (SSE), POST (JSON-RPC), and DELETE (session close) are valid MCP methods.
    // Anything else is rejected before the SDK transport is constructed.
    if (request.method !== "GET" && request.method !== "POST" && request.method !== "DELETE") {
      return new Response(
        JSON.stringify({ error: `Method ${request.method} not allowed on /mcp. Use POST for JSON-RPC or GET for SSE.` }),
        { status: 405, headers: { "Content-Type": "application/json", "Allow": "GET, POST, DELETE, OPTIONS" } }
      );
    }

    // GET /mcp is SSE-only. Reject probes that don't send Accept: text/event-stream
    // before they ever reach the transport — these would hang until Cloudflare canceled them.
    if (request.method === "GET") {
      const accept = request.headers.get("Accept") ?? "";
      if (!accept.includes("text/event-stream")) {
        console.log(JSON.stringify({ event: "mcp_sse_get_rejected", phase: "no_sse_accept", ...requestLog }));
        return new Response(
          JSON.stringify({ error: "GET /mcp is for SSE only. Set Accept: text/event-stream, or use POST /mcp for JSON-RPC." }),
          { status: 406, headers: { "Content-Type": "application/json" } }
        );
      }
      // Client already disconnected before we started — skip transport setup entirely.
      if (request.signal?.aborted) {
        console.log(JSON.stringify({ event: "mcp_sse_get_aborted", phase: "pre_transport", ...requestLog }));
        return new Response(null, { status: 204 });
      }
      // Stateless transport: no sessionIdGenerator, so this server never issues an
      // mcp-session-id. A standalone GET SSE stream therefore can never carry data —
      // the SDK hands back an open ReadableStream that hangs until Cloudflare cancels
      // the Worker (scriptThrewException). Reject GET SSE without a session header fast
      // instead of constructing a transport whose stream never closes.
      const sseSessionId = request.headers.get("mcp-session-id");
      if (!sseSessionId) {
        console.log(JSON.stringify({ event: "mcp_sse_get_rejected", phase: "no_session", ...requestLog }));
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: null,
            error: { code: -32000, message: "Bad Request: Mcp-Session-Id header is required for GET /mcp SSE. Use POST /mcp for JSON-RPC." },
          }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }
      console.log(JSON.stringify({ event: "mcp_sse_get_start", ...requestLog }));
    }

    // POST /mcp must carry a JSON body.
    if (request.method === "POST") {
      const ct = request.headers.get("Content-Type") ?? "";
      if (!ct.includes("application/json")) {
        return new Response(
          JSON.stringify({ error: "POST /mcp requires Content-Type: application/json" }),
          { status: 415, headers: { "Content-Type": "application/json" } }
        );
      }
    }

    try {
      const ip = getClientIp(request);
      await checkRateLimit(ip, env.RATE_LIMITER);
    } catch (err: any) {
      return errResponse(err.message, 429);
    }

    try {
      const transport = new WebStandardStreamableHTTPServerTransport();
      const server = createServer(env, ctx, requestLog);
      await server.connect(transport);

      // For SSE GET: race the transport against a combined abort signal (client
      // disconnect OR 55 s wall-clock) so a hung SSE stream never triggers
      // Cloudflare's "worker hung" cancellation.
      if (request.method === "GET") {
        const controller = new AbortController();
        let tid: ReturnType<typeof setTimeout> | undefined;
        const done = (): void => { clearTimeout(tid); controller.abort(); };
        tid = setTimeout(() => {
          console.log(JSON.stringify({ event: "mcp_sse_get_timeout", phase: "max_age_reached", ...requestLog }));
          done();
        }, 55_000);
        if (request.signal) {
          request.signal.addEventListener("abort", done, { once: true });
        }
        // NOTE: return await so any transport rejection is caught by the try/catch below.
        return await transport.handleRequest(new Request(request, { signal: controller.signal }));
      }

      // NOTE: return await is intentional — an unawaited rejected Promise escapes this
      // try/catch and becomes an unhandled rejection (scriptThrewException in Cloudflare).
      return await transport.handleRequest(request);
    } catch (err: unknown) {
      logEvent("mcp_transport_lifecycle_error", { ...requestLog, phase: "transport_handle" }, err);
      return routeError(err);
    }
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const cronLog: LogFields = { cron_id: crypto.randomUUID(), route: "scheduled", phase: "cron" };
    ctx.waitUntil((async () => {
      try {
        await runScheduledScrape(env, cronLog);
        if (env.ANTHROPIC_KEY) {
          await generateAIBriefing(env.DB, env.ANTHROPIC_KEY);
        } else {
          await formatBriefing(env.DB);
        }
      } catch (err: unknown) {
        logEvent("cron_error", { ...cronLog, phase: "scheduled_handler" }, err);
      }
    })());
  },
} satisfies ExportedHandler<Env>;
