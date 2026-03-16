/**
 * arXiv adapter — uses the official arXiv API (no scraping, no auth needed).
 * Accepts a search query or a direct arXiv API URL.
 * Docs: https://arxiv.org/help/api/user-manual
 */
export async function arxivAdapter(options) {
    const input = options.url.trim();
    // Build API URL — if they pass a plain query, construct it
    const apiUrl = input.startsWith("http")
        ? input
        : `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(input)}&start=0&max_results=10&sortBy=relevance&sortOrder=descending`;
    const res = await fetch(apiUrl, {
        headers: { "User-Agent": "freshcontext-mcp/0.1.7 (https://github.com/PrinceGabriel-lgtm/freshcontext-mcp)" },
    });
    if (!res.ok)
        throw new Error(`arXiv API error: ${res.status} ${res.statusText}`);
    const xml = await res.text();
    // Parse the Atom XML response
    const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)];
    if (!entries.length) {
        return { raw: "No results found for this query.", content_date: null, freshness_confidence: "low" };
    }
    const getTag = (block, tag) => {
        const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
        return m ? m[1].trim().replace(/\s+/g, " ") : "";
    };
    const getAttr = (block, tag, attr) => {
        const m = block.match(new RegExp(`<${tag}[^>]*${attr}="([^"]*)"`, "i"));
        return m ? m[1].trim() : "";
    };
    const papers = entries.map((match, i) => {
        const block = match[1];
        const title = getTag(block, "title").replace(/\n/g, " ");
        const summary = getTag(block, "summary").slice(0, 300).replace(/\n/g, " ");
        const published = getTag(block, "published").slice(0, 10); // YYYY-MM-DD
        const updated = getTag(block, "updated").slice(0, 10);
        const id = getTag(block, "id").replace("http://arxiv.org/abs/", "https://arxiv.org/abs/");
        // Authors — can be multiple
        const authorMatches = [...block.matchAll(/<author>([\s\S]*?)<\/author>/g)];
        const authors = authorMatches
            .map(a => getTag(a[1], "name"))
            .filter(Boolean)
            .slice(0, 4)
            .join(", ");
        // Categories
        const primaryCat = getAttr(block, "arxiv:primary_category", "term") ||
            getAttr(block, "category", "term");
        return [
            `[${i + 1}] ${title}`,
            `Authors: ${authors || "Unknown"}`,
            `Published: ${published}${updated !== published ? ` (updated ${updated})` : ""}`,
            primaryCat ? `Category: ${primaryCat}` : null,
            `Abstract: ${summary}…`,
            `Link: ${id}`,
        ].filter(Boolean).join("\n");
    });
    const raw = papers.join("\n\n").slice(0, options.maxLength ?? 6000);
    // Most recent publication date
    const dates = entries
        .map(m => getTag(m[1], "published").slice(0, 10))
        .filter(Boolean)
        .sort()
        .reverse();
    const content_date = dates[0] ?? null;
    return { raw, content_date, freshness_confidence: content_date ? "high" : "medium" };
}
