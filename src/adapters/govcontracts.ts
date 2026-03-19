import { AdapterResult, ExtractOptions } from "../types.js";

/**
 * Government Contracts adapter — fetches awarded contract data from USASpending.gov
 *
 * No other MCP server has this. USASpending.gov is the official US Treasury
 * database of all federal contract awards. Updated daily.
 *
 * Accepts:
 *   - Company name: "Palantir" → contracts awarded to that company
 *   - Keyword: "AI infrastructure" → contracts with that keyword in description
 *   - NAICS code: "541511" → all software publisher contracts
 *   - Direct URL: https://api.usaspending.gov/... → direct API call
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
  "User-Agent": "Mozilla/5.0 (compatible; freshcontext-mcp/1.0; +https://github.com/PrinceGabriel-lgtm/freshcontext-mcp)",
};

async function fetchJSON(url: string, body?: object): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: HEADERS,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Search by recipient name using autocomplete then awards ─────────────────
async function searchByRecipient(name: string, maxLength: number): Promise<AdapterResult> {
  // Step 1: Use autocomplete to get the exact recipient name USASpending knows
  let recipientName = name;
  try {
    const autoRes = await fetchJSON(
      "https://api.usaspending.gov/api/v2/autocomplete/recipient/",
      { search_text: name, limit: 1 }
    ) as { results?: Array<{ recipient_name: string }> };

    if (autoRes.results?.length) {
      recipientName = autoRes.results[0].recipient_name;
    }
  } catch {
    // Use original name if autocomplete fails
  }

  // Step 2: Search awards with the resolved recipient name
  const body = {
    filters: {
      recipient_search_text: [recipientName],
      time_period: [{
        start_date: new Date(Date.now() - 365 * 2 * 86400000).toISOString().slice(0, 10),
        end_date: new Date().toISOString().slice(0, 10),
      }],
      award_type_codes: ["A", "B", "C", "D"],
    },
    fields: [
      "Award_ID", "Recipient_Name", "Award_Amount",
      "Award_Date", "Start_Date", "End_Date",
      "Awarding_Agency_Name", "Awarding_Sub_Agency_Name",
      "Description", "recipient_location_state_name",
      "recipient_location_city_name", "naics_code", "naics_description",
    ],
    page: 1,
    limit: 10,
    sort: "Award_ID",
    order: "desc",
    subawards: false,
  };

  const data = await fetchJSON(
    "https://api.usaspending.gov/api/v2/search/spending_by_award/",
    body
  ) as { results?: unknown[] };

  if (!data.results?.length) {
    return {
      raw: `No federal contracts found for "${name}" (searched as "${recipientName}") in the last 2 years.\n\nTips:\n- Try the full legal company name (e.g. "Palantir Technologies Inc")\n- Try a keyword search instead (e.g. "AI data analytics")\n- Try a NAICS code (e.g. 541511 for software)`,
      content_date: null,
      freshness_confidence: "high",
    };
  }

  return formatResults(
    data.results as Award[],
    `Federal contracts — ${recipientName}`,
    maxLength
  );
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
    fields: [
      "Award_ID", "Recipient_Name", "Award_Amount",
      "Award_Date", "Start_Date", "End_Date",
      "Awarding_Agency_Name", "Awarding_Sub_Agency_Name",
      "Description", "recipient_location_state_name",
      "naics_code", "naics_description",
    ],
    page: 1,
    limit: 10,
    sort: "Award_ID",
    order: "desc",
    subawards: false,
  };

  const data = await fetchJSON(
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

  return formatResults(
    data.results as Award[],
    `Federal contracts matching "${keyword}"`,
    maxLength
  );
}

// ─── Types ────────────────────────────────────────────────────────────────────
interface Award {
  Award_ID?: string;
  Recipient_Name?: string;
  Award_Amount?: number;
  Description?: string;
  Award_Date?: string;
  Start_Date?: string;
  End_Date?: string;
  Awarding_Agency_Name?: string;
  Awarding_Sub_Agency_Name?: string;
  recipient_location_state_name?: string;
  recipient_location_city_name?: string;
  naics_code?: string;
  naics_description?: string;
}

// ─── Format results ───────────────────────────────────────────────────────────
function formatResults(results: Award[], title: string, maxLength: number): AdapterResult {
  const lines: string[] = [title, ""];

  results.forEach((award, i) => {
    const desc = sanitize(award.Description ?? "No description").slice(0, 300);
    const location = [award.recipient_location_city_name, award.recipient_location_state_name]
      .filter(Boolean).join(", ") || "N/A";

    lines.push(`[${i + 1}] ${sanitize(award.Recipient_Name ?? "Unknown")}`);
    lines.push(`    Amount: ${formatUSD(award.Award_Amount ?? null)}`);
    lines.push(`    Awarded: ${award.Award_Date?.slice(0, 10) ?? "unknown"}`);
    lines.push(`    Period: ${award.Start_Date?.slice(0, 10) ?? "?"} → ${award.End_Date?.slice(0, 10) ?? "?"}`);
    lines.push(`    Agency: ${sanitize(award.Awarding_Agency_Name ?? "N/A")}`);
    if (award.Awarding_Sub_Agency_Name !== award.Awarding_Agency_Name && award.Awarding_Sub_Agency_Name) {
      lines.push(`    Sub-agency: ${sanitize(award.Awarding_Sub_Agency_Name)}`);
    }
    if (award.naics_code) {
      lines.push(`    NAICS: ${award.naics_code} — ${sanitize(award.naics_description ?? "")}`);
    }
    lines.push(`    Location: ${location}`);
    lines.push(`    Description: ${desc}`);
    lines.push("");
  });

  const raw = lines.join("\n").slice(0, maxLength);
  const dates = results.map(r => r.Award_Date).filter(Boolean).sort().reverse();

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

  // Direct API URL
  if (input.startsWith("https://api.usaspending.gov")) {
    const data = await fetchJSON(input);
    return {
      raw: JSON.stringify(data, null, 2).slice(0, maxLength),
      content_date: new Date().toISOString(),
      freshness_confidence: "high",
    };
  }

  // NAICS code (6 digits) — treat as keyword
  if (/^\d{6}$/.test(input)) {
    return searchByKeyword(input, maxLength);
  }

  // Multi-word input or known company name → try recipient first, fall back to keyword
  try {
    const result = await searchByRecipient(input, maxLength);
    if (!result.raw.includes("No federal contracts found")) return result;
    // Fall back to keyword search
    const kwResult = await searchByKeyword(input, maxLength);
    if (!kwResult.raw.includes("No federal contracts found")) return kwResult;
    return result; // Return the "not found" message from recipient search
  } catch (err) {
    // If recipient search fails entirely, try keyword
    return searchByKeyword(input, maxLength);
  }
}
