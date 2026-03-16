import { chromium } from "playwright";
import { validateUrl } from "../security.js";
export async function ycAdapter(options) {
    const safeUrl = validateUrl(options.url, "yc");
    options = { ...options, url: safeUrl };
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    // YC company directory is React-rendered — wait for network to settle
    await page.goto(options.url, { waitUntil: "networkidle", timeout: 30000 });
    // Wait for company cards to appear
    await page.waitForSelector('a[href*="/companies/"]', { timeout: 15000 }).catch(() => null);
    const data = await page.evaluate(`(function() {
    // YC company cards — robust multi-strategy extraction
    var results = [];

    // Strategy 1: structured company divs with name + description + batch
    var cards = Array.from(document.querySelectorAll('div[class*="_company_"]'));

    if (cards.length === 0) {
      // Strategy 2: anchor links to /companies/* pages
      cards = Array.from(document.querySelectorAll('a[href*="/companies/"]'))
        .filter(function(el) {
          return el.querySelector('span, p, div');
        });
    }

    cards.slice(0, 25).forEach(function(el) {
      var allText = el.innerText || el.textContent || "";
      var lines = allText.split('\\n').map(function(l) { return l.trim(); }).filter(Boolean);

      // Try to find structured spans
      var spans = Array.from(el.querySelectorAll('span'));
      var name = null, description = null, batch = null;
      var tags = [];

      spans.forEach(function(s) {
        var t = s.textContent.trim();
        if (!t) return;
        if (s.className && s.className.toString().includes('Name')) name = t;
        else if (s.className && s.className.toString().includes('Desc')) description = t;
        else if (s.className && s.className.toString().includes('Batch')) batch = t;
        else if (s.className && s.className.toString().includes('Tag')) tags.push(t);
      });

      // Fallback to line parsing
      if (!name && lines.length > 0) name = lines[0];
      if (!description && lines.length > 1) description = lines[1];

      var link = el.tagName === 'A'
        ? el.getAttribute('href')
        : (el.querySelector('a') ? el.querySelector('a').getAttribute('href') : null);

      if (name && name.length > 1 && name.length < 80) {
        results.push({ name, description, batch, tags, link });
      }
    });

    return results;
  })()`);
    await browser.close();
    const typedData = data;
    if (!typedData.length) {
        return {
            raw: "No YC companies found — page may have changed structure. Try visiting: " + options.url,
            content_date: null,
            freshness_confidence: "low",
        };
    }
    const raw = typedData
        .map((r, i) => [
        `[${i + 1}] ${r.name ?? "Unknown"}`,
        `Batch: ${r.batch ?? "Unknown"}`,
        `Tags: ${r.tags?.join(", ") || "none"}`,
        `Description: ${r.description ?? "N/A"}`,
        `Link: ${r.link ? (r.link.startsWith("http") ? r.link : "https://www.ycombinator.com" + r.link) : "N/A"}`,
    ].join("\n"))
        .join("\n\n")
        .slice(0, options.maxLength ?? 6000);
    return {
        raw,
        content_date: new Date().toISOString().split("T")[0],
        freshness_confidence: "high",
    };
}
