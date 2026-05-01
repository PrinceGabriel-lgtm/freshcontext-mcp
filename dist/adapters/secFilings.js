/**
 * SEC EDGAR adapter — fetches 8-K filings from the SEC's full-text search API
 *
 * No other MCP server has this. 8-K filings are legally mandated disclosures
 * of material corporate events — CEO changes, acquisitions, data breaches,
 * major contracts, regulatory actions. Filed within 4 business days of the event.
 *
 * This is the most reliable early-warning signal for corporate events in existence.
 * Free, no auth, updated in real time.
 *
 * API: https://efts.sec.gov/LATEST/search-index
 */
const HEADERS = {
    "Accept": "application/json",
    "User-Agent": "freshcontext-mcp/1.0 contact@freshcontext.dev",
};
async function fetchSecFilings(query, maxResults = 10) {
    const today = new Date().toISOString().slice(0, 10);
    const oneYearAgo = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
    const params = new URLSearchParams({
        q: `"${query}"`,
        forms: "8-K",
        dateRange: "custom",
        startdt: oneYearAgo,
        enddt: today,
        hits: String(maxResults),
    });
    const url = `https://efts.sec.gov/LATEST/search-index?${params}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
        const res = await fetch(url, {
            headers: HEADERS,
            signal: controller.signal,
        });
        if (!res.ok) {
            const text = await res.text().catch(() => "");
            throw new Error(`SEC EDGAR HTTP ${res.status}: ${text.slice(0, 200)}`);
        }
        return await res.json();
    }
    finally {
        clearTimeout(timeout);
    }
}
function formatFilings(data, query, maxLength) {
    const hits = data.hits?.hits ?? [];
    const total = data.hits?.total?.value ?? 0;
    if (!hits.length) {
        return {
            raw: `No 8-K filings found for "${query}" in the last year.\n\nTips:\n- Try the full legal company name: "Palantir Technologies"\n- Try a ticker-like keyword: "PLTR"\n- 8-K filings are only for public companies`,
            content_date: null,
            freshness_confidence: "high",
        };
    }
    const lines = [
        `SEC 8-K Filings — ${query}`,
        `${total.toLocaleString()} total filings found (showing ${hits.length})`,
        "",
    ];
    let latestDate = null;
    hits.forEach((hit, i) => {
        const src = hit._source ?? {};
        const entityName = src.entity_name ?? hit.entity_name ?? "Unknown";
        const fileDate = src.filed_at?.slice(0, 10) ?? hit.file_date ?? "unknown";
        const period = src.period_of_report?.slice(0, 10) ?? hit.period_of_report ?? "unknown";
        const formType = src.form_type ?? hit.form_type ?? "8-K";
        const location = [src.biz_location, src.inc_states].filter(Boolean).join(" / ") || "N/A";
        const filingId = hit._id ?? "N/A";
        if (fileDate && fileDate !== "unknown") {
            if (!latestDate || fileDate > latestDate)
                latestDate = fileDate;
        }
        lines.push(`[${i + 1}] ${entityName}`);
        lines.push(`    Form:    ${formType}`);
        lines.push(`    Filed:   ${fileDate}`);
        lines.push(`    Period:  ${period}`);
        lines.push(`    Location: ${location}`);
        lines.push(`    Filing ID: ${filingId}`);
        lines.push(`    View: https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${encodeURIComponent(entityName)}&type=8-K&dateb=&owner=include&count=10`);
        lines.push("");
    });
    lines.push(`Source: SEC EDGAR — https://efts.sec.gov/LATEST/search-index`);
    lines.push(`Note: 8-K filings are legally mandated disclosures of material events filed within 4 business days.`);
    return {
        raw: lines.join("\n").slice(0, maxLength),
        content_date: latestDate,
        freshness_confidence: "high",
    };
}
export async function secFilingsAdapter(options) {
    const query = (options.url ?? "").trim();
    const maxLength = options.maxLength ?? 6000;
    if (!query)
        throw new Error("Company name or keyword required");
    const data = await fetchSecFilings(query);
    return formatFilings(data, query, maxLength);
}
