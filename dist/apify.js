#!/usr/bin/env node
/**
 * Apify Actor entry point — FreshContext MCP v0.3.13
 *
 * Reads Actor input, calls the appropriate adapter, pushes to dataset, exits.
 * All 19 tools supported. Robust error handling throughout.
 */
import { Actor } from "apify";
import { githubAdapter } from "./adapters/github.js";
import { hackerNewsAdapter } from "./adapters/hackernews.js";
import { scholarAdapter } from "./adapters/scholar.js";
import { arxivAdapter } from "./adapters/arxiv.js";
import { redditAdapter } from "./adapters/reddit.js";
import { ycAdapter } from "./adapters/yc.js";
import { productHuntAdapter } from "./adapters/productHunt.js";
import { repoSearchAdapter } from "./adapters/repoSearch.js";
import { packageTrendsAdapter } from "./adapters/packageTrends.js";
import { financeAdapter } from "./adapters/finance.js";
import { jobsAdapter } from "./adapters/jobs.js";
import { changelogAdapter } from "./adapters/changelog.js";
import { govContractsAdapter } from "./adapters/govcontracts.js";
import { secFilingsAdapter } from "./adapters/secFilings.js";
import { gdeltAdapter } from "./adapters/gdelt.js";
import { gebizAdapter } from "./adapters/gebiz.js";
import { stampFreshness } from "./tools/freshnessStamp.js";
async function main() {
    await Actor.init();
    let input;
    try {
        const raw = await Actor.getInput();
        if (!raw || !raw.tool) {
            await Actor.fail("Missing input. Provide a 'tool' field. E.g. { \"tool\": \"extract_hackernews\", \"url\": \"https://news.ycombinator.com\" }");
            return;
        }
        input = raw;
    }
    catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await Actor.fail(`Failed to read input: ${msg}`);
        return;
    }
    // Resolve the primary string input — different tools use different field names
    const url = input.url ?? input.query ?? input.topic ?? input.company ?? input.tickers ?? "";
    const maxLength = input.max_length ?? 8000;
    console.log(`FreshContext Actor | tool: ${input.tool} | input: "${url}"`);
    try {
        let result;
        switch (input.tool) {
            // ── Standard tools ────────────────────────────────────────────
            case "extract_github":
                result = await githubAdapter({ url, maxLength });
                break;
            case "extract_hackernews":
                result = await hackerNewsAdapter({ url, maxLength });
                break;
            case "extract_scholar":
                result = await scholarAdapter({ url, maxLength });
                break;
            case "extract_arxiv":
                result = await arxivAdapter({ url, maxLength });
                break;
            case "extract_reddit":
                result = await redditAdapter({ url, maxLength });
                break;
            case "extract_yc":
                result = await ycAdapter({ url, maxLength });
                break;
            case "extract_producthunt":
                result = await productHuntAdapter({ url, maxLength });
                break;
            case "search_repos":
                result = await repoSearchAdapter({ url, maxLength });
                break;
            case "package_trends":
                result = await packageTrendsAdapter({ url, maxLength });
                break;
            case "extract_finance":
                result = await financeAdapter({ url, maxLength });
                break;
            case "search_jobs":
                result = await jobsAdapter({ url, maxLength });
                break;
            case "extract_changelog":
                result = await changelogAdapter({ url, maxLength });
                break;
            // ── Unique tools ──────────────────────────────────────────────
            case "extract_govcontracts":
                result = await govContractsAdapter({ url, maxLength });
                break;
            case "extract_sec_filings":
                result = await secFilingsAdapter({ url, maxLength });
                break;
            case "extract_gdelt":
                result = await gdeltAdapter({ url, maxLength });
                break;
            case "extract_gebiz":
                result = await gebizAdapter({ url, maxLength });
                break;
            default:
                await Actor.fail(`Unknown tool: "${input.tool}". Valid tools: ` +
                    "extract_github, extract_hackernews, extract_scholar, extract_arxiv, " +
                    "extract_reddit, extract_yc, extract_producthunt, search_repos, " +
                    "package_trends, extract_finance, search_jobs, extract_changelog, " +
                    "extract_govcontracts, extract_sec_filings, extract_gdelt, extract_gebiz");
                return;
        }
        const ctx = stampFreshness(result, { url, maxLength }, input.tool);
        await Actor.pushData({
            tool: ctx.adapter,
            source_url: ctx.source_url,
            content: ctx.content,
            retrieved_at: ctx.retrieved_at,
            content_date: ctx.content_date ?? null,
            freshness_confidence: ctx.freshness_confidence,
        });
        console.log(`✓ Done | retrieved: ${ctx.retrieved_at} | confidence: ${ctx.freshness_confidence}`);
        await Actor.exit();
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`FreshContext error: ${message}`);
        await Actor.fail(message);
    }
}
main().catch(async (err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`Fatal error: ${message}`);
    try {
        await Actor.fail(message);
    }
    catch { /* ignore */ }
    process.exit(1);
});
