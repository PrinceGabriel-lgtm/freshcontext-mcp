import { chromium } from "playwright";
import { AdapterResult, ExtractOptions } from "../types.js";
import { validateUrl } from "../security.js";

export async function scholarAdapter(options: ExtractOptions): Promise<AdapterResult> {
  const safeUrl = validateUrl(options.url, "scholar");
  options = { ...options, url: safeUrl };

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.setExtraHTTPHeaders({
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  });

  await page.goto(options.url, { waitUntil: "domcontentloaded", timeout: 20000 });

  const data = await page.evaluate(`(function() {
    var items = Array.from(document.querySelectorAll('.gs_r.gs_or.gs_scl'));
    var results = items.map(function(el) {
      var titleEl = el.querySelector('.gs_rt');
      var title = titleEl ? titleEl.textContent.trim() : null;
      var authorsEl = el.querySelector('.gs_a');
      var authors = authorsEl ? authorsEl.textContent.trim() : null;
      var snippetEl = el.querySelector('.gs_rs');
      var snippet = snippetEl ? snippetEl.textContent.trim() : null;
      var linkEl = el.querySelector('.gs_rt a');
      var link = linkEl ? linkEl.getAttribute('href') : null;
      var yearMatch = authors ? authors.match(/\\b(19|20)\\d{2}\\b/) : null;
      var year = yearMatch ? yearMatch[0] : null;
      return { title: title, authors: authors, snippet: snippet, link: link, year: year };
    });
    return results;
  })()`);

  await browser.close();

  const typedData = data as Array<{ title: string | null; authors: string | null; snippet: string | null; link: string | null; year: string | null }>;

  if (!typedData.length) {
    return {
      raw: "No results found on this Scholar page.",
      content_date: null,
      freshness_confidence: "low",
    };
  }

  const raw = typedData
    .map((r, i) =>
      [
        `[${i + 1}] ${r.title ?? "Untitled"}`,
        `Authors: ${r.authors ?? "Unknown"}`,
        `Year: ${r.year ?? "Unknown"}`,
        `Snippet: ${r.snippet ?? "N/A"}`,
        `Link: ${r.link ?? "N/A"}`,
      ].join("\n")
    )
    .join("\n\n");

  const years = typedData.map((r) => r.year).filter(Boolean) as string[];
  const newestYear = years.sort().reverse()[0] ?? null;

  return {
    raw,
    content_date: newestYear ? `${newestYear}-01-01` : null,
    freshness_confidence: newestYear ? "high" : "low",
  };
}
