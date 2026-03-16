export async function productHuntAdapter(options) {
    // PH GraphQL API — public, no auth for published posts
    const query = options.url.startsWith("http")
        ? null
        : options.url;
    const gql = query
        ? `{
        posts(first: 20, order: VOTES, search: ${JSON.stringify(query)}) {
          edges {
            node {
              name tagline url votesCount commentsCount createdAt
              topics { edges { node { name } } }
            }
          }
        }
      }`
        : `{
        posts(first: 20, order: VOTES, postedAfter: "${new Date(Date.now() - 7 * 86400000).toISOString()}") {
          edges {
            node {
              name tagline url votesCount commentsCount createdAt
              topics { edges { node { name } } }
            }
          }
        }
      }`;
    const res = await fetch("https://api.producthunt.com/v2/api/graphql", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            // Public access token (read-only, rate-limited but usable)
            "Authorization": "Bearer irgTzMNAz-S-p1P8H5pFCxzU4TEF7GIJZ8vZZi0gLJg",
        },
        body: JSON.stringify({ query: gql }),
    });
    // Fallback: scrape the HTML if the API fails
    if (!res.ok) {
        return scrapeProductHunt(options);
    }
    const data = await res.json();
    if (data.errors?.length || !data.data?.posts?.edges?.length) {
        return scrapeProductHunt(options);
    }
    const posts = data.data.posts.edges;
    const raw = posts
        .map((edge, i) => {
        const p = edge.node;
        const topics = p.topics?.edges?.map((t) => t.node.name).join(", ") ?? "";
        return [
            `[${i + 1}] ${p.name}`,
            `"${p.tagline}"`,
            `↑ ${p.votesCount} upvotes · ${p.commentsCount} comments`,
            topics ? `Topics: ${topics}` : null,
            `Launched: ${p.createdAt?.slice(0, 10) ?? "unknown"}`,
            `Link: ${p.url}`,
        ].filter(Boolean).join("\n");
    })
        .join("\n\n")
        .slice(0, options.maxLength ?? 6000);
    const newest = posts
        .map((e) => e.node.createdAt)
        .filter(Boolean)
        .sort()
        .reverse()[0] ?? null;
    return { raw, content_date: newest, freshness_confidence: newest ? "high" : "medium" };
}
// ─── Fallback scraper ─────────────────────────────────────────────────────────
async function scrapeProductHunt(options) {
    const { chromium } = await import("playwright");
    const url = options.url.startsWith("http")
        ? options.url
        : `https://www.producthunt.com/search?q=${encodeURIComponent(options.url)}`;
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
    await page.waitForTimeout(1500);
    const posts = await page.evaluate(`(function() {
    var items = document.querySelectorAll('[data-test="post-item"], .styles_item__Pf8AC');
    if (!items.length) items = document.querySelectorAll('li[class*="post"]');
    return Array.from(items).slice(0, 20).map(function(el) {
      var name = el.querySelector('h3, [class*="title"]')?.textContent?.trim() ?? null;
      var tagline = el.querySelector('p, [class*="tagline"]')?.textContent?.trim() ?? null;
      var votes = el.querySelector('[class*="vote"], [data-test*="vote"]')?.textContent?.trim() ?? null;
      var link = el.querySelector('a')?.href ?? null;
      return { name, tagline, votes, link };
    }).filter(function(p) { return p.name; });
  })()`);
    await browser.close();
    const typedPosts = posts;
    const raw = typedPosts
        .map((p, i) => [
        `[${i + 1}] ${p.name ?? "Untitled"}`,
        p.tagline ? `"${p.tagline}"` : null,
        p.votes ? `↑ ${p.votes}` : null,
        p.link ? `Link: ${p.link}` : null,
    ].filter(Boolean).join("\n"))
        .join("\n\n")
        .slice(0, options.maxLength ?? 6000);
    return { raw, content_date: new Date().toISOString(), freshness_confidence: "medium" };
}
