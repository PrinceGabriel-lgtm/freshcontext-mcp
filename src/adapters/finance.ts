import { AdapterResult, ExtractOptions } from "../types.js";

/**
 * Finance adapter — no-key Stooq quote feed.
 * Accepts:
 *   - A ticker symbol e.g. "AAPL" or "MSFT"
 *   - Comma-separated tickers for comparison
 *
 * Stooq provides quote/OHLC/volume data, not fundamentals. FreshContext should
 * only stamp observations it actually received.
 */

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

interface ParsedQuote {
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

function toNumber(value: number | string | undefined): number | null {
  if (value === undefined || value === "N/D") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeQuoteTimestamp(date: string, time: string): string {
  if (!date || date === "N/D") throw new Error("Quote date unavailable");
  const clock = time && time !== "N/D" ? time : "00:00:00";
  const parsed = new Date(`${date}T${clock}Z`);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Invalid quote timestamp: ${date} ${time}`);
  return parsed.toISOString();
}

function formatNumber(value: number | string | undefined, prefix = ""): string {
  const n = toNumber(value);
  return n === null ? "N/A" : `${prefix}${n.toLocaleString(undefined, { maximumFractionDigits: 4 })}`;
}

async function fetchStooqQuote(ticker: string): Promise<ParsedQuote> {
  const stooqSymbol = toStooqSymbol(ticker);
  const url = `https://stooq.com/q/l/?s=${encodeURIComponent(stooqSymbol.toLowerCase())}&f=sd2t2ohlcv&h&e=json`;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "freshcontext-mcp/0.3.19",
      "Accept": "application/json",
    },
  });
  if (!res.ok) throw new Error(`Stooq quote API error: ${res.status}`);

  const data = await res.json() as { symbols?: StooqQuote[] };
  const quote = data.symbols?.[0];
  if (!quote) throw new Error(`No quote returned for ${ticker}`);
  if (quote.close === "N/D" || quote.date === "N/D") {
    throw new Error(`No Stooq quote data found for ${ticker}`);
  }

  return {
    requested: ticker,
    stooqSymbol,
    quote,
    timestamp: normalizeQuoteTimestamp(quote.date, quote.time),
  };
}

function formatQuote(result: ParsedQuote): string {
  const q = result.quote;
  return [
    `${result.requested.toUpperCase()} — ${q.symbol}`,
    `source: stooq`,
    `Quote timestamp: ${result.timestamp}`,
    "",
    `Close:  ${formatNumber(q.close, "$")}`,
    `Open:   ${formatNumber(q.open, "$")}`,
    `High:   ${formatNumber(q.high, "$")}`,
    `Low:    ${formatNumber(q.low, "$")}`,
    `Volume: ${formatNumber(q.volume)}`,
  ].join("\n");
}

export async function financeAdapter(options: ExtractOptions): Promise<AdapterResult> {
  const input = options.url.trim();
  const rawTickers = input
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 5);

  if (!rawTickers.length) throw new Error("At least one ticker is required");

  const successes: ParsedQuote[] = [];
  const failures: string[] = [];

  for (const ticker of rawTickers) {
    try {
      successes.push(await fetchStooqQuote(ticker));
    } catch (err) {
      failures.push(`[${ticker.toUpperCase()}] ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (!successes.length) {
    throw new Error(`Finance quote lookup failed for all tickers via source=stooq. ${failures.join("; ")}`);
  }

  const sections = successes.map(formatQuote);
  if (failures.length) {
    sections.push(["Partial failures:", ...failures.map((f) => `- ${f}`)].join("\n"));
  }

  const raw = sections.join("\n\n-----------------------------\n\n").slice(0, options.maxLength ?? 5000);
  const content_date = successes
    .map((s) => s.timestamp)
    .sort()
    .reverse()[0] ?? null;

  return {
    raw,
    content_date,
    freshness_confidence: failures.length ? "medium" : "high",
  };
}
