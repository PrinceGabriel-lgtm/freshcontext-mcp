import { chromium } from "playwright";
import { AdapterResult, ExtractOptions } from "../types.js";

export async function githubAdapter(options: ExtractOptions): Promise<AdapterResult> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Spoof a real browser UA to avoid bot detection
  await page.setExtraHTTPHeaders({
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  });

  await page.goto(options.url, { waitUntil: "domcontentloaded", timeout: 20000 });

  // Extract key repo signals — no inner functions to avoid esbuild __name injection
  const data = await page.evaluate(`(function() {
    var readme = (document.querySelector('[data-target="readme-toc.content"]') || document.querySelector('.markdown-body') || {}).textContent || null;
    var starsEl = document.querySelector('[id="repo-stars-counter-star"]') || document.querySelector('.Counter.js-social-count');
    var stars = starsEl ? starsEl.textContent.trim() : null;
    var forksEl = document.querySelector('[id="repo-network-counter"]');
    var forks = forksEl ? forksEl.textContent.trim() : null;
    var commitEl = document.querySelector('relative-time');
    var lastCommit = commitEl ? commitEl.getAttribute('datetime') : null;
    var descEl = document.querySelector('.f4.my-3');
    var description = descEl ? descEl.textContent.trim() : null;
    var topics = Array.from(document.querySelectorAll('.topic-tag')).map(function(t) { return t.textContent.trim(); });
    var langEl = document.querySelector('.color-fg-default.text-bold.mr-1');
    var language = langEl ? langEl.textContent.trim() : null;
    return { readme: readme, stars: stars, forks: forks, lastCommit: lastCommit, description: description, topics: topics, language: language };
  })()`);
  const typedData = data as { readme: string | null; stars: string | null; forks: string | null; lastCommit: string | null; description: string | null; topics: string[]; language: string | null };

  await browser.close();

  const raw = [
    `Description: ${typedData.description ?? "N/A"}`,
    `Stars: ${typedData.stars ?? "N/A"} | Forks: ${typedData.forks ?? "N/A"}`,
    `Language: ${typedData.language ?? "N/A"}`,
    `Last commit: ${typedData.lastCommit ?? "N/A"}`,
    `Topics: ${typedData.topics?.join(", ") ?? "none"}`,
    `\n--- README ---\n${typedData.readme ?? "No README found"}`,
  ].join("\n");

  return {
    raw,
    content_date: typedData.lastCommit ?? null,
    freshness_confidence: typedData.lastCommit ? "high" : "medium",
  };
}
