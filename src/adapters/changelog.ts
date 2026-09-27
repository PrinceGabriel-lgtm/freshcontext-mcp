import { AdapterResult, ExtractOptions } from "../types.js";
import { SecurityError, validateUrl } from "../security.js";

/**
 * Changelog adapter — extracts update history from any product or repo.
 *
 * Accepts:
 *   - GitHub repo URL: https://github.com/owner/repo → uses Releases API
 *   - npm package name: e.g. "freshcontext-mcp" → fetches from npm registry
 *
 * What it returns:
 *   - Most recent changelog entries with dates
 *   - Version numbers when available
 *   - Content of each entry (truncated)
 *   - freshness_confidence based on how the date was sourced
 *
 * Since 0.5.3, only npm package names and GitHub repository URLs are accepted.
 * Arbitrary-site discovery (a headless browser on the user's machine) was removed.
 *
 * Why this matters for AI agents:
 *   Agents checking "is this tool still maintained?" or "did they ship X feature?"
 *   need to know WHEN changes happened — not just that they happened.
 *   This adapter makes update cadence a first-class signal.
 */

function sanitize(s: string): string {
  return s.replace(/[^\x20-\x7E\n]/g, "").trim();
}

// ─── GitHub Releases API ──────────────────────────────────────────────────────
async function fetchGitHubReleases(owner: string, repo: string, maxLength: number): Promise<AdapterResult> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/releases?per_page=10`,
    { headers: { "Accept": "application/vnd.github.v3+json", "User-Agent": "freshcontext-mcp" } }
  );

  if (!res.ok) {
    let message = "";
    try {
      const body = await res.json() as { message?: string };
      message = body.message ? `: ${body.message}` : "";
    } catch {
      // Keep the status-specific error even if GitHub returns non-JSON.
    }

    if (res.status === 403 || res.status === 429) {
      throw new Error(`GitHub releases API rate limited (${res.status})${message}. Try again later or authenticate upstream.`);
    }

    throw new Error(`GitHub releases API error: ${res.status}${message}`);
  }

  const releases = await res.json() as Array<{
    tag_name: string;
    name: string;
    published_at: string;
    body: string;
    prerelease: boolean;
    draft: boolean;
  }>;

  if (!releases.length) {
    throw new Error(`No GitHub Releases found for ${owner}/${repo}. Git tags are not GitHub Releases; create a release or use an npm package name.`);
  }

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
async function fetchNpmChangelog(packageName: string, maxLength: number): Promise<AdapterResult> {
  const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}`);
  if (!res.ok) throw new Error(`npm registry error: ${res.status}`);

  const data = await res.json() as {
    name: string;
    description: string;
    time: Record<string, string>;
    versions: Record<string, { version: string; description?: string }>;
    "dist-tags": Record<string, string>;
  };

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

// ─── Main export ──────────────────────────────────────────────────────────────
export async function changelogAdapter(options: ExtractOptions): Promise<AdapterResult> {
  const input = (options.url ?? "").trim();
  const maxLength = options.maxLength ?? 6000;

  // npm package name (no http, no dots at start, no slashes)
  if (!input.startsWith("http") && !input.includes("/") && input.length > 0) {
    return fetchNpmChangelog(input, maxLength);
  }

  // GitHub repo URL → use releases API
  const safeInput = validateUrl(input, "changelog");
  const ghUrl = new URL(safeInput);
  const ghMatch = /^(?:www\.)?github\.com$/i.test(ghUrl.hostname) ? ghUrl.pathname.match(/^\/([^/]+)\/([^/?\s]+)/) : null;
  if (ghMatch) {
    return fetchGitHubReleases(ghMatch[1], ghMatch[2].replace(/\.git$/, ""), maxLength);
  }

  // Any other URL: arbitrary-site discovery drove a headless browser on the user's machine and was
  // removed in 0.5.3 for security. Only the npm registry and the GitHub Releases API are used.
  throw new SecurityError(
    "Changelog discovery on arbitrary websites was removed in 0.5.3 for security. " +
      "Pass an npm package name or a GitHub repository URL."
  );
}
