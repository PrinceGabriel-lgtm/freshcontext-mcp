function formatMarketCap(cap) {
    if (!cap)
        return "N/A";
    if (cap >= 1e12)
        return `$${(cap / 1e12).toFixed(2)}T`;
    if (cap >= 1e9)
        return `$${(cap / 1e9).toFixed(2)}B`;
    if (cap >= 1e6)
        return `$${(cap / 1e6).toFixed(2)}M`;
    return `$${cap.toLocaleString()}`;
}
function formatChange(change, pct) {
    if (change === undefined || pct === undefined)
        return "N/A";
    const sign = change >= 0 ? "+" : "";
    return `${sign}${change.toFixed(2)} (${sign}${pct.toFixed(2)}%)`;
}
export async function financeAdapter(options) {
    const input = options.url.trim();
    // Support comma-separated tickers
    const rawTickers = input
        .split(",")
        .map((t) => t.trim().toUpperCase())
        .filter(Boolean)
        .slice(0, 5); // max 5 at once
    const results = [];
    let latestTimestamp = null;
    for (const ticker of rawTickers) {
        try {
            const quoteData = await fetchQuote(ticker);
            if (quoteData) {
                results.push(formatQuote(quoteData));
                if (quoteData.regularMarketTime) {
                    latestTimestamp = Math.max(latestTimestamp ?? 0, quoteData.regularMarketTime);
                }
            }
        }
        catch (err) {
            results.push(`[${ticker}] Error: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    const raw = results.join("\n\n─────────────────────────────\n\n").slice(0, options.maxLength ?? 5000);
    const content_date = latestTimestamp
        ? new Date(latestTimestamp * 1000).toISOString()
        : new Date().toISOString();
    return { raw, content_date, freshness_confidence: "high" };
}
async function fetchQuote(ticker) {
    // v7 quote endpoint — public, no auth
    const quoteUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(ticker)}&fields=shortName,longName,regularMarketPrice,regularMarketChange,regularMarketChangePercent,marketCap,regularMarketVolume,fiftyTwoWeekHigh,fiftyTwoWeekLow,trailingPE,dividendYield,currency,exchangeName,regularMarketTime`;
    const quoteRes = await fetch(quoteUrl, {
        headers: {
            "User-Agent": "Mozilla/5.0 (compatible; freshcontext-mcp/0.1.5)",
            "Accept": "application/json",
        },
    });
    if (!quoteRes.ok)
        throw new Error(`Yahoo Finance API error: ${quoteRes.status}`);
    const quoteJson = await quoteRes.json();
    const quote = quoteJson?.quoteResponse?.result?.[0];
    if (!quote)
        throw new Error(`No data found for ticker: ${ticker}`);
    // Optionally fetch company summary (v11 quoteSummary)
    try {
        const summaryUrl = `https://query1.finance.yahoo.com/v11/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=assetProfile`;
        const summaryRes = await fetch(summaryUrl, {
            headers: { "User-Agent": "Mozilla/5.0 (compatible; freshcontext-mcp/0.1.5)" },
        });
        if (summaryRes.ok) {
            const summaryJson = await summaryRes.json();
            const profile = summaryJson?.quoteSummary?.result?.[0]?.assetProfile;
            if (profile) {
                Object.assign(quote, {
                    longBusinessSummary: profile.longBusinessSummary,
                    sector: profile.sector,
                    industry: profile.industry,
                    fullTimeEmployees: profile.fullTimeEmployees,
                    website: profile.website,
                });
            }
        }
    }
    catch {
        // Summary is optional — continue without it
    }
    return quote;
}
function formatQuote(q) {
    const lines = [
        `${q.symbol} — ${q.longName ?? q.shortName ?? "Unknown"}`,
        `Exchange: ${q.exchangeName ?? "N/A"} · Currency: ${q.currency ?? "USD"}`,
        "",
        `Price:       ${q.regularMarketPrice !== undefined ? `$${q.regularMarketPrice.toFixed(2)}` : "N/A"}`,
        `Change:      ${formatChange(q.regularMarketChange, q.regularMarketChangePercent)}`,
        `Market Cap:  ${formatMarketCap(q.marketCap)}`,
        `Volume:      ${q.regularMarketVolume?.toLocaleString() ?? "N/A"}`,
        `52w High:    ${q.fiftyTwoWeekHigh !== undefined ? `$${q.fiftyTwoWeekHigh.toFixed(2)}` : "N/A"}`,
        `52w Low:     ${q.fiftyTwoWeekLow !== undefined ? `$${q.fiftyTwoWeekLow.toFixed(2)}` : "N/A"}`,
        `P/E Ratio:   ${q.trailingPE !== undefined ? q.trailingPE.toFixed(2) : "N/A"}`,
        `Div Yield:   ${q.dividendYield !== undefined ? `${(q.dividendYield * 100).toFixed(2)}%` : "N/A"}`,
    ];
    if (q.sector || q.industry) {
        lines.push("");
        if (q.sector)
            lines.push(`Sector:      ${q.sector}`);
        if (q.industry)
            lines.push(`Industry:    ${q.industry}`);
        if (q.fullTimeEmployees)
            lines.push(`Employees:   ${q.fullTimeEmployees.toLocaleString()}`);
        if (q.website)
            lines.push(`Website:     ${q.website}`);
    }
    if (q.longBusinessSummary) {
        lines.push("", "About:", q.longBusinessSummary.slice(0, 500) + (q.longBusinessSummary.length > 500 ? "…" : ""));
    }
    return lines.join("\n");
}
