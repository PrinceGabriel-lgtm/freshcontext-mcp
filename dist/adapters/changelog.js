/**
 * Changelog adapter — extracts update history from any product or repo.
 *
 * Accepts:
 *   - Any URL: https://example.com → auto-discovers /changelog, /releases, /CHANGELOG.md
 *   - GitHub repo URL: https://github.com/owner/repo → uses Releases API
 *   - Direct changelog URL: https://example.com/changelog
 *   - npm package name: e.g. "freshcontext-mcp" → fetches from npm registry
 *
 * What it returns:
 *   - Most recent changelog entries with dates
 *   - Version numbers when available
 *   - Content of each entry (truncated)
 *   - freshness_confidence based on how the date was sourced
 *
 * Why this matters for AI agents:
 *   Agents checking "is this tool still maintained?" or "did they ship X feature?"
 *   need to know WHEN changes happened — not just that they happened.
 *   This adapter makes update cadence a first-class signal.
 */
const CHANGELOG_PATHS = [
    "/changelog",
    "/CHANGELOG",
    "/CHANGELOG.md",
    "/CHANGELOG.txt",
    "/releases",
    "/blog/changelog",
    "/blog/releases",
    "/updates",
    "/whats-new",
    "/what-s-new",
    "/release-notes",
];
function sanitize(s) {
    return s.replace(/[^\x20-\x7E\n]/g, "").trim();
}
// ─── GitHub Releases API ──────────────────────────────────────────────────────
async function fetchGitHubReleases(owner, repo, maxLength) {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases?per_page=10`, { headers: { "Accept": "application/vnd.github.v3+json", "User-Agent": "freshcontext-mcp" } });
    if (!res.ok)
        throw new Error(`GitHub releases API error: ${res.status}`);
    const releases = await res.json();
    if (!releases.length)
        throw new Error("No releases found");
    const stable = releases.filter((r) => !r.prerelease && !r.draft);
    const items = stable.length ? stable : releases;
    const raw = items
        .slice(0, 8)
        .map((r, i) => {
        const body = sanitize(r.body ?? "").slice(0, 500);
        return [
            `[${i + 1}] ${r.tag_name}${r.name && r.name !== r.tag_name ? ` — ${r.name}` : ""}`,
            `Released: ${r.published_at?.slice(0, 10) ?? "unknown"}`,
            body ? `\n${body}` : "(no release notes)",
        ].join("\n");
    })
        .join("\n\n")
        .slice(0, maxLength);
    const newest = items[0]?.published_at ?? null;
    return { raw, content_date: newest, freshness_confidence: "high" };
}
// ─── npm Registry ─────────────────────────────────────────────────────────────
async function fetchNpmChangelog(packageName, maxLength) {
    const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}`);
    if (!res.ok)
        throw new Error(`npm registry error: ${res.status}`);
    const data = await res.json();
    const times = data.time ?? {};
    const versions = Object.keys(times)
        .filter((k) => k !== "created" && k !== "modified" && /^\d/.test(k))
        .sort((a, b) => new Date(times[b]).getTime() - new Date(times[a]).getTime())
        .slice(0, 10);
    const latest = data["dist-tags"]?.latest ?? versions[0];
    const raw = [
        `Package: ${data.name}`,
        `Description: ${data.description ?? "N/A"}`,
        `Latest: ${latest} (${times[latest]?.slice(0, 10) ?? "unknown"})`,
        ``,
        `Recent versions:`,
        ...versions.map((v) => `  ${v} — ${times[v]?.slice(0, 10) ?? "unknown"}`),
    ].join("\n").slice(0, maxLength);
    const newest = versions[0] ? times[versions[0]] : null;
    return { raw, content_date: newest ?? null, freshness_confidence: newest ? "high" : "medium" };
}
// ─── Browser-based changelog discovery ───────────────────────────────────────
async function discoverChangelog(baseUrl, maxLength) {
    const { chromium } = await import("playwright");
    // Strip trailing slash and path — we want the root for discovery
    const urlObj = new URL(baseUrl);
    // If the URL already looks like a changelog page, go directly
    const isDirectChangelog = CHANGELOG_PATHS.some((p) => urlObj.pathname.toLowerCase().includes(p.replace("/", "")));
    const targetUrls = isDirectChangelog
        ? [baseUrl]
        : [baseUrl, ...CHANGELOG_PATHS.map((p) => `${urlObj.origin}${p}`)];
    const browser = await chromium.launch({ headless: true });
    for (const url of targetUrls) {
        const page = await browser.newPage();
        try {
            const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
            if (!res || !res.ok()) {
                await page.close();
                continue;
            }
            // Check if we landed on a real page with content
            const content = await page.evaluate(`(function() {
        // Try to find changelog-like content
        var selectors = [
          'article', 'main', '.changelog', '.releases', '.release-notes',
          '[class*="changelog"]', '[class*="release"]', '[id*="changelog"]',
          '[id*="release"]', '.prose', '.content', '.markdown-body'
        ];

        var el = null;
        for (var i = 0; i < selectors.length; i++) {
          el = document.querySelector(selectors[i]);
          if (el && el.innerText && el.innerText.length > 100) break;
        }

        if (!el) el = document.body;

        var text = el ? el.innerText : '';

        // Extract dates — look for version/date patterns
        var datePattern = /\\b(20\\d{2}[-/.](0[1-9]|1[0-2])[-/.](0[1-9]|[12]\\d|3[01]))\\b/g;
        var versionPattern = /v?\\d+\\.\\d+(\\.\\d+)?(-\\w+)?/g;

        var dates = (text.match(datePattern) || []).slice(0, 5);
        var versions = (text.match(versionPattern) || []).slice(0, 5);

        // Truncate to first 3000 chars of meaningful content
        var truncated = text
          .split('\\n')
          .filter(function(l) { return l.trim().length > 0; })
          .slice(0, 60)
          .join('\\n');

        return {
          text: truncated,
          dates: dates,
          versions: versions,
          title: document.title,
          url: window.location.href,
          hasContent: text.length > 200
        };
      })`);
            const result = content;
            if (!result.hasContent) {
                await page.close();
                continue;
            }
            // Check if this actually looks like a changelog
            const looksLikeChangelog = result.url.toLowerCase().includes("changelog") ||
                result.url.toLowerCase().includes("release") ||
                result.url.toLowerCase().includes("update") ||
                result.title.toLowerCase().includes("changelog") ||
                result.title.toLowerCase().includes("release") ||
                result.dates.length > 0 ||
                result.versions.length > 1;
            if (!looksLikeChangelog && url !== baseUrl) {
                await page.close();
                continue;
            }
            await browser.close();
            const raw = [
                `Source: ${result.url}`,
                `Title: ${result.title}`,
                result.versions.length ? `Versions found: ${result.versions.join(", ")}` : null,
                result.dates.length ? `Dates found: ${result.dates.join(", ")}` : null,
                ``,
                sanitize(result.text),
            ].filter(Boolean).join("\n").slice(0, maxLength);
            // Best date is the first/most recent date found
            const newestDate = result.dates.length > 0
                ? result.dates.sort().reverse()[0]
                : null;
            const confidence = result.dates.length > 0 ? "medium" : "low";
            return { raw, content_date: newestDate, freshness_confidence: confidence };
        }
        catch {
            await page.close();
            continue;
        }
    }
    await browser.close();
    throw new Error(`No changelog found at ${baseUrl} or common changelog paths`);
}
// ─── Main export ──────────────────────────────────────────────────────────────
export async function changelogAdapter(options) {
    const input = (options.url ?? "").trim();
    const maxLength = options.maxLength ?? 6000;
    // npm package name (no http, no dots at start, no slashes)
    if (!input.startsWith("http") && !input.includes("/") && input.length > 0) {
        return fetchNpmChangelog(input, maxLength);
    }
    // GitHub repo URL → use releases API
    const ghMatch = input.match(/github\.com\/([^/]+)\/([^/?\s]+)/);
    if (ghMatch) {
        try {
            return await fetchGitHubReleases(ghMatch[1], ghMatch[2], maxLength);
        }
        catch {
            // Fall through to browser scrape if API fails
        }
    }
    // Any other URL → discover changelog
    return discoverChangelog(input, maxLength);
}
