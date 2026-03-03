import { AdapterResult, ExtractOptions } from "../types.js";

// Uses npm registry API + PyPI JSON API (no auth needed)
export async function packageTrendsAdapter(options: ExtractOptions): Promise<AdapterResult> {
  // options.url is the package name or a comma-separated list
  // e.g. "langchain" or "npm:langchain" or "pypi:langchain"
  const raw_input = options.url.replace(/^https?:\/\//, "").trim();

  // Parse ecosystem prefix
  const parts = raw_input.split(",").map((s) => s.trim());
  const results: string[] = [];
  let latestDate: string | null = null;

  for (const pkg of parts) {
    const isExplicitPypi = pkg.startsWith("pypi:");
    const isExplicitNpm = pkg.startsWith("npm:");
    const pkgName = pkg.replace(/^(pypi:|npm:)/, "");

    // Try npm
    if (!isExplicitPypi) {
      try {
        const npmRes = await fetch(`https://registry.npmjs.org/${encodeURIComponent(pkgName)}`, {
          headers: { Accept: "application/json" },
        });
        if (npmRes.ok) {
          const npmData = await npmRes.json() as {
            name: string;
            description?: string;
            "dist-tags"?: { latest?: string };
            time?: Record<string, string>;
            homepage?: string;
            keywords?: string[];
            repository?: { url?: string };
          };

          const latestVersion = npmData["dist-tags"]?.latest ?? "unknown";
          const modified = npmData.time?.modified ?? null;
          const created = npmData.time?.created ?? null;
          const versions = Object.keys(npmData.time ?? {}).filter((k) => !["created", "modified"].includes(k)).length;

          if (modified && (!latestDate || modified > latestDate)) latestDate = modified;

          results.push([
            `📦 [npm] ${npmData.name}`,
            `Latest version: ${latestVersion}`,
            `Total versions: ${versions}`,
            `Description: ${npmData.description ?? "N/A"}`,
            `Keywords: ${npmData.keywords?.join(", ") ?? "none"}`,
            `Created: ${created ?? "unknown"}`,
            `Last updated: ${modified ?? "unknown"}`,
            `Homepage: ${npmData.homepage ?? "N/A"}`,
          ].join("\n"));
          continue;
        }
      } catch { /* fall through to PyPI */ }
    }

    // Try PyPI
    if (!isExplicitNpm) {
      try {
        const pypiRes = await fetch(`https://pypi.org/pypi/${encodeURIComponent(pkgName)}/json`);
        if (pypiRes.ok) {
          const pypiData = await pypiRes.json() as {
            info: {
              name: string;
              version: string;
              summary?: string;
              keywords?: string;
              home_page?: string;
              project_urls?: Record<string, string>;
            };
            releases?: Record<string, unknown[]>;
            urls?: Array<{ upload_time: string }>;
          };

          const info = pypiData.info;
          const releaseCount = Object.keys(pypiData.releases ?? {}).length;
          const latestUpload = pypiData.urls?.[0]?.upload_time ?? null;

          if (latestUpload && (!latestDate || latestUpload > latestDate)) latestDate = latestUpload;

          results.push([
            `🐍 [PyPI] ${info.name}`,
            `Latest version: ${info.version}`,
            `Total releases: ${releaseCount}`,
            `Description: ${info.summary ?? "N/A"}`,
            `Keywords: ${info.keywords ?? "none"}`,
            `Last release: ${latestUpload ?? "unknown"}`,
            `Homepage: ${info.home_page ?? info.project_urls?.Homepage ?? "N/A"}`,
          ].join("\n"));
          continue;
        }
      } catch { /* not found */ }
    }

    results.push(`❌ Package not found on npm or PyPI: ${pkgName}`);
  }

  return {
    raw: results.join("\n\n").slice(0, options.maxLength ?? 5000),
    content_date: latestDate,
    freshness_confidence: latestDate ? "high" : "low",
  };
}
