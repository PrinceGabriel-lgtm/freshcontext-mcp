import { chromium } from "playwright";
import { AdapterResult, ExtractOptions } from "../types.js";
import { validateUrl } from "../security.js";

function isUrl(input: string): boolean {
  try {
    new URL(input);
    return true;
  } catch {
    return false;
  }
}

function normalizeHnDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const match = raw.match(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?\b/);
  if (!match) return null;
  const isoLike = match[0].endsWith("Z") ? match[0] : `${match[0]}Z`;
  const parsed = new Date(isoLike);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export async function hackerNewsAdapter(options: ExtractOptions): Promise<AdapterResult> {
  const input = options.url.trim();
  if (!input) throw new Error("HN URL or search query is required");

  const url = isUrl(input) ? validateUrl(input, "hackernews") : `hn-search:${input}`;

  if (url.includes("hn.algolia.com/api/") || url.startsWith("hn-search:")) {
    const query = url.startsWith("hn-search:")
      ? url.replace("hn-search:", "").trim()
      : url;

    const apiUrl = url.includes("hn.algolia.com/api/")
      ? url
      : `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=story&hitsPerPage=20`;

    const res = await fetch(apiUrl);
    if (!res.ok) throw new Error(`HN Algolia API error: ${res.status}`);
    const data = await res.json() as {
      hits: Array<{
        title: string;
        url: string | null;
        points: number;
        num_comments: number;
        author: string;
        created_at: string;
        objectID: string;
      }>;
    };

    const raw = data.hits
      .map((r, i) =>
        [
          `[${i + 1}] ${r.title ?? "Untitled"}`,
          `URL: ${r.url ?? `https://news.ycombinator.com/item?id=${r.objectID}`}`,
          `Score: ${r.points} points | ${r.num_comments} comments`,
          `Author: ${r.author} | Posted: ${normalizeHnDate(r.created_at) ?? r.created_at}`,
        ].join("\n")
      )
      .join("\n\n")
      .slice(0, options.maxLength ?? 4000);

    const newest = data.hits
      .map((r) => normalizeHnDate(r.created_at))
      .filter((d): d is string => Boolean(d))
      .sort()
      .reverse()[0] ?? null;

    return { raw, content_date: newest, freshness_confidence: newest ? "high" : "medium" };
  }

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

  const typedData = data as Array<{ title: string | null; link: string | null; score: string | null; age: string | null; commentLink: string | null }>;

  const raw = typedData
    .map((r, i) => {
      const date = normalizeHnDate(r.age);
      return [
        `[${i + 1}] ${r.title ?? "Untitled"}`,
        `URL: ${r.link ?? "N/A"}`,
        `Score: ${r.score ?? "N/A"} | ${r.commentLink ?? ""}`,
        `Posted: ${date ?? "unknown"}`,
      ].join("\n");
    })
    .join("\n\n");

  const newestDate = typedData
    .map((r) => normalizeHnDate(r.age))
    .filter((d): d is string => Boolean(d))
    .sort()
    .reverse()[0] ?? null;

  return {
    raw,
    content_date: newestDate,
    freshness_confidence: newestDate ? "high" : "medium",
  };
}
