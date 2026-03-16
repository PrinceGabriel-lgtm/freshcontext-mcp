import { chromium } from "playwright";
import { validateUrl } from "../security.js";
export async function hackerNewsAdapter(options) {
    // Validate URL — allow both HN and Algolia domains
    validateUrl(options.url, "hackernews");
    const url = options.url;
    if (url.includes("hn.algolia.com/api/") || url.startsWith("hn-search:")) {
        const query = url.startsWith("hn-search:")
            ? url.replace("hn-search:", "").trim()
            : url;
        const apiUrl = url.includes("hn.algolia.com/api/")
            ? url
            : `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=20`;
        const res = await fetch(apiUrl);
        if (!res.ok)
            throw new Error(`HN Algolia API error: ${res.status}`);
        const data = await res.json();
        const raw = data.hits
            .map((r, i) => [
            `[${i + 1}] ${r.title ?? "Untitled"}`,
            `URL: ${r.url ?? `https://news.ycombinator.com/item?id=${r.objectID}`}`,
            `Score: ${r.points} points | ${r.num_comments} comments`,
            `Author: ${r.author} | Posted: ${r.created_at}`,
        ].join("\n"))
            .join("\n\n")
            .slice(0, options.maxLength ?? 4000);
        const newest = data.hits.map((r) => r.created_at).sort().reverse()[0] ?? null;
        return { raw, content_date: newest, freshness_confidence: newest ? "high" : "medium" };
    }
    // Default: browser-based scrape for HN front page or search pages
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    const data = await page.evaluate(`(function() {
    var items = Array.from(document.querySelectorAll('.athing')).slice(0, 20);
    var results = items.map(function(el) {
      var titleLineEl = el.querySelector('.titleline > a');
      var title = titleLineEl ? titleLineEl.textContent.trim() : null;
      var link = titleLineEl ? titleLineEl.getAttribute('href') : null;
      var subtext = el.nextElementSibling;
      var scoreEl = subtext ? subtext.querySelector('.score') : null;
      var score = scoreEl ? scoreEl.textContent.trim() : null;
      var ageEl = subtext ? subtext.querySelector('.age') : null;
      var age = ageEl ? ageEl.getAttribute('title') : null;
      var anchors = subtext ? subtext.querySelectorAll('a') : [];
      var commentLink = anchors.length > 0 ? anchors[anchors.length - 1].textContent.trim() : null;
      return { title: title, link: link, score: score, age: age, commentLink: commentLink };
    });
    return results;
  })()`);
    await browser.close();
    const typedData = data;
    const raw = typedData
        .map((r, i) => [
        `[${i + 1}] ${r.title ?? "Untitled"}`,
        `URL: ${r.link ?? "N/A"}`,
        `Score: ${r.score ?? "N/A"} | ${r.commentLink ?? ""}`,
        `Posted: ${r.age ?? "unknown"}`,
    ].join("\n"))
        .join("\n\n");
    const newestDate = typedData.map((r) => r.age).filter(Boolean).sort().reverse()[0] ?? null;
    return {
        raw,
        content_date: newestDate,
        freshness_confidence: newestDate ? "high" : "medium",
    };
}
