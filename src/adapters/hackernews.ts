import { chromium } from "playwright";
import { AdapterResult, ExtractOptions } from "../types";

export async function hackerNewsAdapter(options: ExtractOptions): Promise<AdapterResult> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto(options.url, { waitUntil: "domcontentloaded", timeout: 20000 });

  const data = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll(".athing")).slice(0, 20).map((el) => {
      const title = el.querySelector(".titleline > a")?.textContent?.trim();
      const link = el.querySelector(".titleline > a")?.getAttribute("href");
      const subtext = el.nextElementSibling;
      const score = subtext?.querySelector(".score")?.textContent?.trim();
      const age = subtext?.querySelector(".age")?.getAttribute("title"); // ISO timestamp
      const comments = subtext?.querySelectorAll("a");
      const commentLink = comments ? comments[comments.length - 1]?.textContent?.trim() : null;

      return { title, link, score, age, commentLink };
    });
    return items;
  });

  await browser.close();

  const raw = data
    .map((r, i) =>
      [`[${i + 1}] ${r.title}`, `URL: ${r.link}`, `Score: ${r.score ?? "N/A"} | ${r.commentLink ?? ""}`, `Posted: ${r.age ?? "unknown"}`].join("\n")
    )
    .join("\n\n");

  const newestDate = data.map((r) => r.age).filter(Boolean).sort().reverse()[0] ?? null;

  return {
    raw,
    content_date: newestDate,
    freshness_confidence: newestDate ? "high" : "medium",
  };
}
