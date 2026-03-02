import { chromium } from "playwright";
import { AdapterResult, ExtractOptions } from "../types.js";

export async function hackerNewsAdapter(options: ExtractOptions): Promise<AdapterResult> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  await page.goto(options.url, { waitUntil: "domcontentloaded", timeout: 20000 });

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

  const typedData = data as Array<{ title: string | null; link: string | null; score: string | null; age: string | null; commentLink: string | null }>;

  const raw = typedData
    .map((r, i) =>
      [
        `[${i + 1}] ${r.title ?? "Untitled"}`,
        `URL: ${r.link ?? "N/A"}`,
        `Score: ${r.score ?? "N/A"} | ${r.commentLink ?? ""}`,
        `Posted: ${r.age ?? "unknown"}`,
      ].join("\n")
    )
    .join("\n\n");

  const newestDate = typedData.map((r) => r.age).filter(Boolean).sort().reverse()[0] ?? null;

  return {
    raw,
    content_date: newestDate,
    freshness_confidence: newestDate ? "high" : "medium",
  };
}
