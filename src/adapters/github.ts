import { chromium } from "playwright";
import { AdapterResult, ExtractOptions } from "../types";

export async function githubAdapter(options: ExtractOptions): Promise<AdapterResult> {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  // Spoof a real browser UA to avoid bot detection
  await page.setExtraHTTPHeaders({
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  });

  await page.goto(options.url, { waitUntil: "domcontentloaded", timeout: 20000 });

  // Extract key repo signals
  const data = await page.evaluate(() => {
    const getText = (sel: string) => document.querySelector(sel)?.textContent?.trim() ?? null;

    const readme = document.querySelector('[data-target="readme-toc.content"]')?.textContent?.trim()
      ?? getText(".markdown-body");

    const stars = getText('[id="repo-stars-counter-star"]') ?? getText(".Counter.js-social-count");
    const forks = getText('[id="repo-network-counter"]');
    const lastCommit = getText("relative-time");
    const description = getText(".f4.my-3");
    const topics = Array.from(document.querySelectorAll(".topic-tag")).map((t) => t.textContent?.trim());
    const language = getText(".color-fg-default.text-bold.mr-1");

    return { readme, stars, forks, lastCommit, description, topics, language };
  });

  await browser.close();

  const raw = [
    `Description: ${data.description ?? "N/A"}`,
    `Stars: ${data.stars ?? "N/A"} | Forks: ${data.forks ?? "N/A"}`,
    `Language: ${data.language ?? "N/A"}`,
    `Last commit: ${data.lastCommit ?? "N/A"}`,
    `Topics: ${data.topics?.join(", ") ?? "none"}`,
    `\n--- README ---\n${data.readme ?? "No README found"}`,
  ].join("\n");

  return {
    raw,
    content_date: data.lastCommit ?? null,
    freshness_confidence: data.lastCommit ? "high" : "medium",
  };
}
