import { AdapterResult, ExtractOptions } from "../types.js";

/**
 * Government Contracts adapter — fetches awarded contract data from USASpending.gov
 *
 * Why this is unique:
 *   No other MCP server exposes government contract data.
 *   For GTM teams, VC investors, and competitive researchers, knowing when a
 *   company wins a government contract is a high-signal buying intent indicator.
 *   A company that just won a $2M DoD contract is hiring, spending, and building.
 *
 * Accepts:
 *   - Company name: "Cloudflare" → finds contracts awarded to that company
 *   - NAICS code: "541511" → software publishers contracts
 *   - Agency name: "Department of Defense" → all DoD contracts
 *   - Keyword: "AI infrastructure" → contracts with that keyword
 *   - A URL: https://api.usaspending.gov/... → direct API call
 *
 * Data source: USASpending.gov public API (no API key required)
 * Coverage: All US federal contracts, grants, and awards
 * Freshness: Updated daily by the US Treasury
 *
 * What it returns:
 *   - Award recipient name and location
 *   - Contract amount (obligated)
 *   - Award date (high confidence timestamp)
 *   - Awarding agency and sub-agency
 *   - Contract description / award title
 *   - NAICS code and description
 *   - Period of performance dates
 */

function sanitize(s: string): string {
  return s.replace(/[^\x20-\x7E]/g, "").trim();
}

function formatUSD(amount: number | null): string {
  if (amount === null || isNaN(amount)) return "N/A";
  if (Math.abs(amount) >= 1_000_000) return `$${(amount / 1_000_000).toFixed(2)}M`;
  if (Math.abs(amount) >= 1_000) return `$${(amount / 1_000).toFixed(1)}K`;
  return `$${amount.toFixed(0)}`;
}

interface USASpendingAward {
  Award_ID: string;
  Recipient_Name: string;
  Award_Amount: number;
  Total_Outlays: number | null;
  Description: string;
  Contract_Award_Unique_Key: string;
  Award_Date: string;
  Start_Date: string;
  End_Date: string;
  Awarding_Agency_Name: string;
  Awarding_Sub_Agency_Name: string;
  recipient_location_state_name: string;
  recipient_location_city_name: string;
  naics_code: string;
  naics_description: string;
}

interface USASpendingResponse {
  results: USASpendingAward[];
  page_metadata?: {
    count: number;
    total: number;
    page: number;
  };
}

// ─── Search by recipient (company name) ──────────────────────────────────────
async function searchByRecipient(query: string, maxLength: number): Promise<AdapterResult> {
  const body = {
    filters: {
      recipient_search_text: [query],
      time_period: [
        {
          start_date: new Date(Date.now() - 365 * 2 * 86400000).toISOString().slice(0, 10),
          end_date: new Date().toISOString().slice(0, 10),
        },
      ],
      award_type_codes: ["A", "B", "C", "D"], // contracts only
    },
    fields: [
      "Award_ID", "Recipient_Name", "Award_Amount", "Description",
      "Award_Date", "Start_Date", "End_Date",
      "Awarding_Agency_Name", "Awarding_Sub_Agency_Name",
      "recipient_location_state_name", "recipient_location_city_name",
      "naics_code", "naics_description",
    ],
    page: 1,
    limit: 10,
    sort: "Award_Amount",
    order: "desc",
    subawards: false,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch("https://api.usaspending.gov/api/v2/search/spending_by_award/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; freshcontext-mcp/1.0)",
        "Origin": "https://www.usaspending.gov",
        "Referer": "https://www.usaspending.gov/",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    if (!res.ok) throw new Error(`USASpending API error: ${res.status} ${res.statusText}`);
    const data = await res.json() as USASpendingResponse;

    if (!data.results?.length) {
      return {
        raw: `No federal contracts found for "${query}" in the last 2 years.\n\nThis could mean:\n- The company name differs from the registered recipient name\n- The company operates under a subsidiary name\n- No contracts awarded in this period\n\nTry searching by parent company name or NAICS code.`,
        content_date: null,
        freshness_confidence: "high",
      };
    }

    return formatResults(data.results, `Federal contracts — ${query}`, maxLength);
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Search by keyword ────────────────────────────────────────────────────────
async function searchByKeyword(keyword: string, maxLength: number): Promise<AdapterResult> {
  const body = {
    filters: {
      keywords: [keyword],
      time_period: [
        {
          start_date: new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10),
          end_date: new Date().toISOString().slice(0, 10),
        },
      ],
      award_type_codes: ["A", "B", "C", "D"],
    },
    fields: [
      "Award_ID", "Recipient_Name", "Award_Amount", "Description",
      "Award_Date", "Start_Date", "End_Date",
      "Awarding_Agency_Name", "Awarding_Sub_Agency_Name",
      "recipient_location_state_name", "naics_code", "naics_description",
    ],
    page: 1,
    limit: 10,
    sort: "Award_Amount",
    order: "desc",
    subawards: false,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch("https://api.usaspending.gov/api/v2/search/spending_by_award/", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (compatible; freshcontext-mcp/1.0)",
        "Origin": "https://www.usaspending.gov",
        "Referer": "https://www.usaspending.gov/",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    if (!res.ok) throw new Error(`USASpending keyword search error: ${res.status} ${res.statusText}`);
    const data = await res.json() as USASpendingResponse;

    if (!data.results?.length) {
      return {
        raw: `No federal contracts found matching keyword "${keyword}" in the last year.`,
        content_date: null,
        freshness_confidence: "high",
      };
    }

    return formatResults(data.results, `Federal contracts matching "${keyword}"`, maxLength);
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Format results ───────────────────────────────────────────────────────────
function formatResults(results: USASpendingAward[], title: string, maxLength: number): AdapterResult {
  const lines: string[] = [title, ""];

  results.forEach((award, i) => {
    const desc = sanitize(award.Description ?? "No description");
    const location = [award.recipient_location_city_name, award.recipient_location_state_name]
      .filter(Boolean).join(", ") || "N/A";

    lines.push(`[${i + 1}] ${sanitize(award.Recipient_Name ?? "Unknown")}`);
    lines.push(`    Amount: ${formatUSD(award.Award_Amount)}`);
    lines.push(`    Awarded: ${award.Award_Date?.slice(0, 10) ?? "unknown"}`);
    lines.push(`    Period: ${award.Start_Date?.slice(0, 10) ?? "?"} → ${award.End_Date?.slice(0, 10) ?? "?"}`);
    lines.push(`    Agency: ${sanitize(award.Awarding_Agency_Name ?? "N/A")}`);
    if (award.Awarding_Sub_Agency_Name && award.Awarding_Sub_Agency_Name !== award.Awarding_Agency_Name) {
      lines.push(`    Sub-agency: ${sanitize(award.Awarding_Sub_Agency_Name)}`);
    }
    if (award.naics_code) {
      lines.push(`    NAICS: ${award.naics_code} — ${sanitize(award.naics_description ?? "")}`);
    }
    lines.push(`    Location: ${location}`);
    lines.push(`    Description: ${desc.slice(0, 200)}`);
    lines.push("");
  });

  const raw = lines.join("\n").slice(0, maxLength);

  // Newest award date for freshness
  const dates = results
    .map((r) => r.Award_Date)
    .filter(Boolean)
    .sort()
    .reverse();

  return {
    raw,
    content_date: dates[0] ?? null,
    freshness_confidence: "high", // USASpending dates are structured API fields
  };
}

// ─── Main export ──────────────────────────────────────────────────────────────
export async function govContractsAdapter(options: ExtractOptions): Promise<AdapterResult> {
  const input = (options.url ?? "").trim();
  const maxLength = options.maxLength ?? 6000;

  if (!input) throw new Error("Query required: company name, keyword, or NAICS code");

  // Direct API URL
  if (input.startsWith("https://api.usaspending.gov")) {
    const res = await fetch(input, { headers: { "User-Agent": "freshcontext-mcp" } });
    if (!res.ok) throw new Error(`USASpending direct fetch error: ${res.status}`);
    const data = await res.json();
    const raw = JSON.stringify(data, null, 2).slice(0, maxLength);
    return { raw, content_date: new Date().toISOString(), freshness_confidence: "high" };
  }

  // NAICS code (6 digits)
  if (/^\d{6}$/.test(input)) {
    return searchByKeyword(input, maxLength);
  }

  // Default: try as recipient name first, fall back to keyword
  try {
    const result = await searchByRecipient(input, maxLength);
    // If no results found, try keyword search
    if (result.raw.includes("No federal contracts found")) {
      const kwResult = await searchByKeyword(input, maxLength);
      if (!kwResult.raw.includes("No federal contracts found")) {
        return kwResult;
      }
    }
    return result;
  } catch {
    return searchByKeyword(input, maxLength);
  }
}
