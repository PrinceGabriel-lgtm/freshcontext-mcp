import { chromium } from "playwright";
import { AdapterResult, ExtractOptions } from "../types.js";

export async function ycAdapter(options: ExtractOptions): Promise<AdapterResult> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Support both YC batch pages and search
  await page.goto(options.url, { waitUntil: "domcontentloaded", timeout: 30000 });

  const data = await page.evaluate(`(function() {
    // YC company cards on ycombinator.com/companies
    var cards = Array.from(document.querySelectorAll('._company_86jzd_338, .company-card, [class*="company"]')).slice(0, 30);

    if (cards.length === 0) {
      // Fallback: try the YC startup directory structure
      cards = Array.from(document.querySelectorAll('a[href*="/companies/"]')).slice(0, 30);
    }

    var results = cards.map(function(el) {
      var name = el.querySelector('span[class*="coName"], .company-name, h3, h2') || el;
      var desc = el.querySelector('span[class*="coDescription"], .company-description, p');
      var batch = el.querySelector('span[class*="coBatch"], .batch, [class*="batch"]');
      var tags = Array.from(el.querySelectorAll('span[class*="coTag"], .tag, [class*="tag"]')).map(function(t) { return t.textContent.trim(); });
      var link = el.tagName === 'A' ? el.getAttribute('href') : (el.querySelector('a') ? el.querySelector('a').getAttribute('href') : null);
      return {
        name: name ? name.textContent.trim() : null,
        description: desc ? desc.textContent.trim() : null,
        batch: batch ? batch.textContent.trim() : null,
        tags: tags.slice(0, 5),
        link: link
      };
    }).filter(function(r) { return r.name && r.name.length > 1; });

    return results;
  })()`);

  await browser.close();

  const typedData = data as Array<{
    name: string | null;
    description: string | null;
    batch: string | null;
    tags: string[];
    link: string | null;
  }>;

  if (!typedData.length) {
    return {
      raw: "No YC companies found. Try https://www.ycombinator.com/companies?query=YOUR_KEYWORD",
      content_date: null,
      freshness_confidence: "low",
    };
  }

  const raw = typedData
    .map((r, i) =>
      [
        `[${i + 1}] ${r.name ?? "Unknown"}`,
        `Batch: ${r.batch ?? "Unknown"}`,
        `Tags: ${r.tags.join(", ") || "none"}`,
        `Description: ${r.description ?? "N/A"}`,
        `Link: ${r.link ? "https://www.ycombinator.com" + r.link : "N/A"}`,
      ].join("\n")
    )
    .join("\n\n")
    .slice(0, options.maxLength ?? 6000);

  return {
    raw,
    content_date: new Date().toISOString().split("T")[0],
    freshness_confidence: "high",
  };
}
