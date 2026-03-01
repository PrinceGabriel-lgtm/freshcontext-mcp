import { chromium } from "playwright";
import { AdapterResult, ExtractOptions } from "../types";

export async function scholarAdapter(options: ExtractOptions): Promise<AdapterResult> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.setExtraHTTPHeaders({
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  });

  await page.goto(options.url, { waitUntil: "domcontentloaded", timeout: 20000 });

  const data = await page.evaluate(() => {
    const results = Array.from(document.querySelectorAll(".gs_r.gs_or.gs_scl")).map((el) => {
      const title = el.querySelector(".gs_rt")?.textContent?.trim();
      const authors = el.querySelector(".gs_a")?.textContent?.trim();
      const snippet = el.querySelector(".gs_rs")?.textContent?.trim();
      const link = el.querySelector(".gs_rt a")?.getAttribute("href");

      // Parse year from authors/date line e.g. "Smith, J - Journal, 2023 - publisher"
      const yearMatch = authors?.match(/\b(19|20)\d{2}\b/);
      const year = yearMatch ? yearMatch[0] : null;

      return { title, authors, snippet, link, year };
    });

    return results;
  });

  await browser.close();

  if (!data.length) {
    return {
      raw: "No results found on this Scholar page.",
      content_date: null,
      freshness_confidence: "low",
    };
  }

  const raw = data
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

  const years = data.map((r) => r.year).filter(Boolean) as string[];
  const newestYear = years.sort().reverse()[0] ?? null;

  return {
    raw,
    content_date: newestYear ? `${newestYear}-01-01` : null,
    freshness_confidence: newestYear ? "high" : "low",
  };
}
