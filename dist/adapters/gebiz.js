/**
 * GeBIZ adapter — fetches Singapore Government procurement opportunities
 * from data.gov.sg (Ministry of Finance official open dataset)
 *
 * No other MCP server has this. GeBIZ is Singapore's One-Stop E-Procurement
 * Portal. All open tenders from government agencies since FY2020 are published
 * here as structured open data.
 *
 * Free, no auth, updated continuously.
 *
 * API: https://data.gov.sg/api/action/datastore_search
 * Dataset: d_acde1106003906a75c3fa052592f2fcb
 *
 * Accepts:
 *   - Keyword search: "AI", "software", "data analytics"
 *   - Agency name: "GovTech", "MOH", "MAS"
 *   - Empty string: returns latest tenders across all agencies
 */
const DATASET_ID = "d_acde1106003906a75c3fa052592f2fcb";
const BASE_URL = "https://data.gov.sg/api/action/datastore_search";
const HEADERS = {
    "Accept": "application/json",
    "User-Agent": "freshcontext-mcp/1.0 contact@freshcontext.dev",
};
function formatDate(raw) {
    if (!raw)
        return "N/A";
    // Dates come as DD/MM/YYYY or ISO
    return raw.slice(0, 10);
}
function formatAmt(raw) {
    if (!raw || raw === "NA" || raw === "")
        return "N/A";
    const n = parseFloat(raw.replace(/[^0-9.]/g, ""));
    if (isNaN(n))
        return raw;
    if (n >= 1_000_000)
        return `S$${(n / 1_000_000).toFixed(2)}M`;
    if (n >= 1_000)
        return `S$${(n / 1_000).toFixed(1)}K`;
    return `S$${n.toFixed(0)}`;
}
async function fetchGeBIZ(query, limit = 15) {
    const params = new URLSearchParams({
        resource_id: DATASET_ID,
        limit: String(limit),
        sort: "_id desc", // most recent first
    });
    // Add full-text search if query provided
    if (query.trim()) {
        params.set("q", query.trim());
    }
    const url = `${BASE_URL}?${params}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
        const res = await fetch(url, {
            headers: HEADERS,
            signal: controller.signal,
        });
        if (!res.ok) {
            const text = await res.text().catch(() => "");
            throw new Error(`GeBIZ API HTTP ${res.status}: ${text.slice(0, 200)}`);
        }
        return await res.json();
    }
    finally {
        clearTimeout(timeout);
    }
}
function formatRecords(data, query, maxLength) {
    const records = data.result?.records ?? [];
    const total = data.result?.total ?? 0;
    if (!records.length) {
        return {
            raw: `No GeBIZ tenders found for "${query}".\n\nTips:\n- Try a broader keyword: "software" or "data"\n- Try an agency name: "GovTech" or "MOH"\n- Leave query empty to see all recent tenders`,
            content_date: null,
            freshness_confidence: "high",
        };
    }
    const lines = [
        `GeBIZ Singapore Government Procurement — ${query || "All Recent Tenders"}`,
        `${total.toLocaleString()} total records found (showing ${records.length})`,
        `Source: data.gov.sg — Ministry of Finance open dataset`,
        "",
    ];
    let latestDate = null;
    records.forEach((r, i) => {
        const awardDate = formatDate(r.awarded_date);
        const closeDate = formatDate(r.tender_close_date);
        const dateStr = r.awarded_date ?? r.tender_close_date ?? null;
        if (dateStr && dateStr !== "NA") {
            // Parse DD/MM/YYYY
            const parts = dateStr.split("/");
            let iso = null;
            if (parts.length === 3) {
                iso = `${parts[2]}-${parts[1]}-${parts[0]}`;
            }
            else if (dateStr.length >= 10) {
                iso = dateStr.slice(0, 10);
            }
            if (iso && (!latestDate || iso > latestDate))
                latestDate = iso;
        }
        const desc = (r.description ?? "No description").slice(0, 300);
        const agency = r.agency ?? "N/A";
        const tenderNo = r.tender_no ?? "N/A";
        const status = r.tender_detail_status ?? "N/A";
        const category = r.procurement_category ?? "N/A";
        const supplier = r.supplier_name ?? "N/A";
        const amount = formatAmt(r.awarded_amt);
        lines.push(`[${i + 1}] ${desc}`);
        lines.push(`    Agency:     ${agency}`);
        lines.push(`    Tender No:  ${tenderNo}`);
        lines.push(`    Category:   ${category}`);
        lines.push(`    Status:     ${status}`);
        if (supplier !== "N/A")
            lines.push(`    Supplier:   ${supplier}`);
        if (amount !== "N/A")
            lines.push(`    Amount:     ${amount}`);
        lines.push(`    Close Date: ${closeDate}`);
        if (awardDate !== "N/A")
            lines.push(`    Awarded:    ${awardDate}`);
        lines.push("");
    });
    lines.push(`Full dataset: https://data.gov.sg/datasets/d_acde1106003906a75c3fa052592f2fcb/view`);
    lines.push(`Register as supplier: https://www.gebiz.gov.sg/cmw/content/getstart.html`);
    return {
        raw: lines.join("\n").slice(0, maxLength),
        content_date: latestDate,
        freshness_confidence: "high",
    };
}
export async function gebizAdapter(options) {
    const query = (options.url ?? "").trim();
    const maxLength = options.maxLength ?? 6000;
    const data = await fetchGeBIZ(query);
    return formatRecords(data, query, maxLength);
}
