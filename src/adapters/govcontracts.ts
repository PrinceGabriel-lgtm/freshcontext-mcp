import { AdapterResult, ExtractOptions } from "../types.js";

/**
 * Government Contracts adapter — fetches awarded contract data from USASpending.gov
 *
 * No other MCP server has this. USASpending.gov is the official US Treasury
 * database of all federal contract awards. Updated daily.
 *
 * FIELD NAMING: USASpending API uses space-separated field names e.g. "Award ID",
 * "Recipient Name", "Award Amount" — NOT underscores.
 *
 * Accepts:
 *   - Company name: "Palantir" → contracts awarded to that company
 *   - Keyword: "AI infrastructure" → contracts with that keyword in description
 *   - NAICS code: "541511" → all software publisher contracts
 */

function sanitize(s: string): string {
  return s.replace(/[^\x20-\x7E]/g, "").trim();
}

function formatUSD(amount: number | null): string {
  if (amount === null || amount === undefined || isNaN(amount)) return "N/A";
  const abs = Math.abs(amount);
  if (abs >= 1_000_000_000) return `$${(amount / 1_000_000_000).toFixed(2)}B`;
  if (abs >= 1_000_000) return `$${(amount / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${(amount / 1_000).toFixed(1)}K`;
  return `$${amount.toFixed(0)}`;
}

const HEADERS = {
  "Content-Type": "application/json",
  "Accept": "application/json",
  "User-Agent": "Mozilla/5.0 (compatible; freshcontext-mcp/1.0)",
};

// USASpending API field names — space-separated, not underscores
const CONTRACT_FIELDS = [
  "Award ID",
  "Recipient Name",
  "Award Amount",
  "Award Date",
  "Start Date",
  "End Date",
  "Awarding Agency",
  "Awarding Sub Agency",
  "Description",
  "Place of Performance State Code",
  "Place of Performance City Name",
  "naics_code",
  "naics_description",
];

async function postJSON(url: string, body: object): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: HEADERS,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function getJSON(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: HEADERS,
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Build award search body ──────────────────────────────────────────────────
function buildSearchBody(filters: object): object {
  return {
    filters: {
      ...filters,
      time_period: [{
        start_date: new Date(Date.now() - 365 * 2 * 86400000).toISOString().slice(0, 10),
        end_date: new Date().toISOString().slice(0, 10),
      }],
      award_type_codes: ["A", "B", "C", "D"],
    },
    fields: CONTRACT_FIELDS,
    page: 1,
    limit: 10,
    sort: "Award Amount",  // space-separated — matches field name exactly
    order: "desc",
    subawards: false,
  };
}

// ─── Resolve company name via autocomplete ────────────────────────────────────
async function resolveRecipientName(name: string): Promise<string> {
  try {
    const data = await postJSON(
      "https://api.usaspending.gov/api/v2/autocomplete/recipient/",
      { search_text: name, limit: 1 }
    ) as { results?: Array<{ recipient_name: string }> };
    if (data.results?.length) return data.results[0].recipient_name;
  } catch { /* fall through */ }
  return name;
}

// ─── Search by recipient name ─────────────────────────────────────────────────
async function searchByRecipient(name: string, maxLength: number): Promise<AdapterResult> {
  const recipientName = await resolveRecipientName(name);

  const data = await postJSON(
    "https://api.usaspending.gov/api/v2/search/spending_by_award/",
    buildSearchBody({ recipient_search_text: [recipientName] })
  ) as { results?: unknown[] };

  if (!data.results?.length) {
    return {
      raw: `No federal contracts found for "${name}" (resolved to "${recipientName}") in the last 2 years.\n\nTips:\n- Try a keyword instead: "AI data analytics"\n- Try a NAICS code: "541511" (software)\n- Try the full legal name: "Palantir Technologies Inc"`,
      content_date: null,
      freshness_confidence: "high",
    };
  }

  return formatResults(data.results as Award[], `Federal contracts — ${recipientName}`, maxLength);
}

// ─── Search by keyword ────────────────────────────────────────────────────────
async function searchByKeyword(keyword: string, maxLength: number): Promise<AdapterResult> {
  const body = {
    filters: {
      keywords: [keyword],
      time_period: [{
        start_date: new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10),
        end_date: new Date().toISOString().slice(0, 10),
      }],
      award_type_codes: ["A", "B", "C", "D"],
    },
    fields: CONTRACT_FIELDS,
    page: 1,
    limit: 10,
    sort: "Award Amount",
    order: "desc",
    subawards: false,
  };

  const data = await postJSON(
    "https://api.usaspending.gov/api/v2/search/spending_by_award/",
    body
  ) as { results?: unknown[] };

  if (!data.results?.length) {
    return {
      raw: `No federal contracts found matching "${keyword}" in the last year.`,
      content_date: null,
      freshness_confidence: "high",
    };
  }

  return formatResults(data.results as Award[], `Federal contracts matching "${keyword}"`, maxLength);
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface Award {
  "Award ID"?: string;
  "Recipient Name"?: string;
  "Award Amount"?: number;
  "Description"?: string;
  "Award Date"?: string;
  "Start Date"?: string;
  "End Date"?: string;
  "Awarding Agency"?: string;
  "Awarding Sub Agency"?: string;
  "Place of Performance State Code"?: string;
  "Place of Performance City Name"?: string;
  "naics_code"?: string;
  "naics_description"?: string;
}

// ─── Format results ───────────────────────────────────────────────────────────
function formatResults(results: Award[], title: string, maxLength: number): AdapterResult {
  const lines: string[] = [title, ""];

  results.forEach((award, i) => {
    const desc = sanitize(award["Description"] ?? "No description").slice(0, 300);
    const location = [
      award["Place of Performance City Name"],
      award["Place of Performance State Code"],
    ].filter(Boolean).join(", ") || "N/A";
    const subAgency = award["Awarding Sub Agency"];
    const agency = award["Awarding Agency"];

    lines.push(`[${i + 1}] ${sanitize(award["Recipient Name"] ?? "Unknown")}`);
    lines.push(`    Amount:  ${formatUSD(award["Award Amount"] ?? null)}`);
    lines.push(`    Awarded: ${award["Award Date"]?.slice(0, 10) ?? "unknown"}`);
    lines.push(`    Period:  ${award["Start Date"]?.slice(0, 10) ?? "?"} → ${award["End Date"]?.slice(0, 10) ?? "?"}`);
    lines.push(`    Agency:  ${sanitize(agency ?? "N/A")}`);
    if (subAgency && subAgency !== agency) {
      lines.push(`    Sub:     ${sanitize(subAgency)}`);
    }
    if (award["naics_code"]) {
      lines.push(`    NAICS:   ${award["naics_code"]} — ${sanitize(award["naics_description"] ?? "")}`);
    }
    lines.push(`    Location: ${location}`);
    lines.push(`    Desc:    ${desc}`);
    lines.push("");
  });

  const raw = lines.join("\n").slice(0, maxLength);
  const dates = results
    .map(r => r["Award Date"])
    .filter((d): d is string => Boolean(d))
    .sort()
    .reverse();

  return {
    raw,
    content_date: dates[0] ?? null,
    freshness_confidence: "high",
  };
}

// ─── Main export ──────────────────────────────────────────────────────────────
export async function govContractsAdapter(options: ExtractOptions): Promise<AdapterResult> {
  const input = (options.url ?? "").trim();
  const maxLength = options.maxLength ?? 6000;

  if (!input) throw new Error("Query required: company name, keyword, or NAICS code");

  // Direct GET endpoint (non-search URLs)
  if (input.startsWith("https://api.usaspending.gov") && !input.includes("spending_by_award")) {
    const data = await getJSON(input);
    return {
      raw: JSON.stringify(data, null, 2).slice(0, maxLength),
      content_date: new Date().toISOString(),
      freshness_confidence: "high",
    };
  }

  // NAICS code (6 digits)
  if (/^\d{6}$/.test(input)) {
    return searchByKeyword(input, maxLength);
  }

  // Company name or keyword — try recipient first, fall back to keyword
  try {
    const result = await searchByRecipient(input, maxLength);
    if (!result.raw.includes("No federal contracts found")) return result;
    const kwResult = await searchByKeyword(input, maxLength);
    if (!kwResult.raw.includes("No federal contracts found")) return kwResult;
    return result;
  } catch {
    return searchByKeyword(input, maxLength);
  }
}
