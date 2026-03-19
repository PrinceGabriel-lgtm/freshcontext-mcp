# FreshContext — Architecture Upgrade Roadmap V1
**Date:** 2026-03-19
**Author:** Immanuel Gabriel (Prince Gabriel), Grootfontein, Namibia

This document describes every free structural upgrade available to FreshContext,
prioritised by impact, with implementation notes for each.

---

## Upgrade 1 — freshness_score numeric field (HIGHEST PRIORITY)

**What it is:** The FreshContext Specification v1.0 defines an optional freshness_score
field (0-100) calculated as: max(0, 100 - (days_since_retrieved * decay_rate)).
Right now every response carries the text envelope and the confidence level (high/medium/low)
but not the numeric score. This is the one remaining piece that makes FreshContext fully
spec-compliant by your own standard.

**Why it matters:** Once the score exists, agents can filter results programmatically —
"only use results with freshness_score > 70" rather than parsing the string confidence
level. This is the difference between a label and a query parameter. It also strengthens
the acquisition narrative: the spec is complete, the reference implementation is complete,
and the standard is fully self-consistent.

**Domain-specific decay rates from the spec:**
Financial data decays at 5.0 (half-life ~10 days). Job listings at 3.0 (~17 days).
News and HN at 2.0 (~25 days). GitHub repos at 1.0 (~50 days). Academic papers at 0.3
(~167 days). General web content defaults to 1.5.

**Where to implement:** In src/tools/freshnessStamp.ts — the function that wraps every
adapter result already has retrieved_at and content_date. Add a calculateFreshnessScore
function that takes content_date, decay_rate (looked up by adapter name), and returns
the numeric score. Add it to both the text envelope and the JSON form.

**Cost:** Zero. Pure TypeScript logic, no new services.

---

## Upgrade 2 — Cloudflare KV response caching

**What it is:** When the same query hits an adapter twice within a short window, the
Worker currently makes two full upstream API calls. KV caching stores the first result
with a TTL and serves subsequent identical requests from cache — meaning the upstream
API (USASpending, GitHub, HN, etc.) only gets called once per cache window.

**Why it matters:** This reduces the chance of hitting upstream rate limits, makes
repeated queries near-instant for users, and reduces Worker CPU time. For adapters like
extract_govcontracts that call a government API, caching also reduces the risk of
temporary blocks from aggressive polling.

**Implementation:** In the Worker code (worker/src/index.ts or equivalent), before calling
the adapter, compute a cache key as sha256(tool + ":" + url). Call env.KV.get(cacheKey).
If the result exists, return it immediately. If not, run the adapter, then call
env.KV.put(cacheKey, result, { expirationTtl: ttl }) before returning. Use adapter-specific
TTLs — 3600 seconds (1 hour) for HN and Reddit, 21600 (6 hours) for GitHub and YC,
86400 (24 hours) for govcontracts and scholar.

**Cost:** Zero. KV reads are free up to 100,000 per day, writes free up to 1,000 per day
on Cloudflare's free tier. You are nowhere near those limits.

---

## Upgrade 3 — Apify Actor timeout increase

**What it is:** The Apify Actor timeout is currently set to 300 seconds (5 minutes). Tools
that use Playwright to launch a browser — extract_reddit, extract_yc, extract_producthunt —
need more time than this to launch Chromium, navigate, wait for the page to render, and
extract content. They will keep timing out until this setting is increased.

**Where to change it:** Apify console → your Actor → Settings → Timeout. Change from
300 to 3600 (1 hour). This is a UI change, not a code change.

**Cost:** Zero. The timeout setting is just a number. You won't actually use anywhere
near 3600 seconds — most tools complete in 10-30 seconds. The setting just prevents Apify
from killing the process prematurely for the slower Playwright-based tools.

---

## Upgrade 4 — D1 deduplication in the cron job

**What it is:** Every 6 hours the cron job runs all 18 watched queries and stores results
in the scrape_results D1 table. Right now there is no deduplication — if the same article
or repo appears in two consecutive cron runs, it gets stored twice. Over time this creates
noise in the dataset and wastes storage.

**Implementation:** Before inserting a new result, run a SELECT to check whether a row
with the same source_url already exists within the last 24 hours. If it does, skip the
insert. This is a single SQL WHERE clause addition to the existing insert logic.

**Why it matters:** As you build the intelligence layer (Layer 7 in the roadmap), the
quality of the historical signal depends on clean, deduplicated data. Starting deduplication
now means the dataset is clean by the time you need it.

**Cost:** Zero. D1 reads are free up to 25 million rows per day. A deduplication check
adds one read per result per cron run — trivially within limits.

---

## Upgrade 5 — Structured JSON response form in every adapter

**What it is:** The FreshContext Specification defines two valid response formats — the
text envelope ([FRESHCONTEXT]...[/FRESHCONTEXT]) and an optional structured JSON form with
a freshcontext object containing source_url, content_date, retrieved_at,
freshness_confidence, adapter, and freshness_score fields. Right now only the text envelope
is returned. Adding the JSON form makes FreshContext usable programmatically without
parsing the text envelope.

**Implementation:** In src/tools/freshnessStamp.ts, after assembling the text envelope,
also return a structured object. When the Worker serves a response, detect whether the
request has Accept: application/json and serve the structured form instead of the text
form if so. Both formats can also be returned together — text for human/agent reading,
JSON for programmatic use.

**Cost:** Zero. This is a response format change, no new services.

---

## Upgrade 6 — GitHub Actions: version bump automation

**What it is:** The current GitHub Actions workflow (publish.yml) runs npm publish on every
push, but only succeeds if the version in package.json has changed. Right now you manually
bump the version before pushing. A small addition to the workflow can automate this by
running npm version patch automatically before the publish step — so every push to main
creates a new patch version and publishes it without any manual intervention.

**Tradeoff:** This means every push creates a new npm version, which may not always be
desirable for documentation-only changes. A better approach is to only auto-bump when
commits touch src/ or .actor/ — which can be detected in the workflow with a path filter.

**Implementation:** Add a paths filter to the workflow trigger so it only runs the publish
step when source files change. Then add an npm version patch --no-git-tag-version step
before the publish step. Push the bumped package.json back to the repo using a
git commit and git push within the workflow (requires GITHUB_TOKEN, which is automatically
available in all Actions workflows at no cost).

**Cost:** Zero.

---

## Upgrade 7 — server.json version sync check

**What it is:** The server.json file (used by the MCP Registry listing) still shows version
0.3.1 while package.json is at 0.3.10. This discrepancy means anyone who discovers
FreshContext via the MCP Registry sees an outdated version number. It is a cosmetic issue
but it affects credibility in a space where people are evaluating tools carefully.

**Implementation:** Add a step to the GitHub Actions workflow that reads the version from
package.json and uses sed or node -e to update the version field in server.json to match
before committing. Alternatively, update server.json manually now and keep it in sync
going forward.

**Cost:** Zero.

---

## Priority Order for Implementation

The order that maximises impact relative to effort is as follows. Implement the Apify
timeout increase first because it is a one-field UI change that immediately fixes the
broken Actor runs. Implement KV caching second because it makes the Worker more robust
against upstream API instability and improves response times for repeat queries. Implement
the freshness_score calculation third because it completes the spec and strengthens every
conversation about acquisition or partnership. Implement D1 deduplication fourth because
it improves data quality for the intelligence layer you will eventually build. Implement
the structured JSON response form fifth as part of the same PR as freshness_score since
they touch the same file. Implement the GitHub Actions version sync last as a quality-of-life
automation.

The total engineering cost of all six remaining upgrades is approximately 4-6 hours of
focused work. All run entirely within free tiers.

---

*"The work isn't gone. It's just waiting to be continued."*
*— Prince Gabriel, Grootfontein, Namibia*
