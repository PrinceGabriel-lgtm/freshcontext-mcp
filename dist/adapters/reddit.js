/**
 * Reddit adapter — public JSON API, no auth required.
 * Accepts subreddit URLs or search queries.
 * e.g. https://www.reddit.com/r/MachineLearning/.json
 *      https://www.reddit.com/search.json?q=mcp+server&sort=hot
 */
export async function redditAdapter(options) {
    let apiUrl = options.url;
    // If they pass a plain subreddit name like "r/MachineLearning", build the URL
    if (!apiUrl.startsWith("http")) {
        const clean = apiUrl.replace(/^r\//, "");
        apiUrl = `https://www.reddit.com/r/${clean}/.json?limit=25&sort=hot`;
    }
    // Ensure we hit the JSON endpoint
    if (!apiUrl.includes(".json")) {
        apiUrl = apiUrl.replace(/\/?$/, ".json");
    }
    // Add limit if not present
    if (!apiUrl.includes("limit=")) {
        apiUrl += (apiUrl.includes("?") ? "&" : "?") + "limit=25";
    }
    const res = await fetch(apiUrl, {
        headers: {
            "User-Agent": "freshcontext-mcp/0.1.5 (https://github.com/PrinceGabriel-lgtm/freshcontext-mcp)",
            "Accept": "application/json",
        },
    });
    if (!res.ok)
        throw new Error(`Reddit API error: ${res.status} ${res.statusText}`);
    const data = await res.json();
    const posts = data?.data?.children ?? [];
    if (posts.length === 0)
        throw new Error("No posts found — check the subreddit or search URL.");
    const raw = posts
        .slice(0, 20)
        .map((child, i) => {
        const p = child.data;
        const date = new Date(p.created_utc * 1000).toISOString();
        const lines = [
            `[${i + 1}] ${p.title}`,
            `r/${p.subreddit} · u/${p.author} · ${date.slice(0, 10)}`,
            `↑ ${p.score} upvotes · ${p.num_comments} comments`,
            `Link: https://reddit.com${p.permalink}`,
        ];
        if (p.is_self && p.selftext) {
            lines.push(`Preview: ${p.selftext.slice(0, 200).replace(/\n/g, " ")}…`);
        }
        return lines.join("\n");
    })
        .join("\n\n")
        .slice(0, options.maxLength ?? 6000);
    const newest = posts
        .map((c) => c.data.created_utc)
        .sort((a, b) => b - a)[0];
    const content_date = newest
        ? new Date(newest * 1000).toISOString()
        : null;
    return { raw, content_date, freshness_confidence: content_date ? "high" : "medium" };
}
