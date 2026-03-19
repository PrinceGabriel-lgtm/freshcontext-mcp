# FreshContext — Architecture Upgrade Checklist
**Date started:** 2026-03-19
**Author:** Prince Gabriel, Grootfontein, Namibia

---

## [ ] Upgrade 1 — freshness_score numeric field
Implement the 0-100 numeric score defined in FRESHCONTEXT_SPEC.md.
Formula: max(0, 100 - (days_since_retrieved * decay_rate))
Location: src/tools/freshnessStamp.ts
Decay rates by adapter: finance=5.0, jobs=3.0, hackernews=2.0, github=1.0, scholar=0.3, default=1.5
Adds the score to both the text envelope and the JSON form.
Makes FreshContext fully spec-compliant by your own standard.
Cost: zero.

---

## [ ] Upgrade 2 — Cloudflare KV response caching
Cache adapter results in KV with adapter-specific TTLs so the same query
hitting the Worker twice doesn't make two upstream API calls.
Cache key: sha256(tool + ":" + url)
TTLs: HN/Reddit = 1 hour, GitHub/YC = 6 hours, govcontracts/scholar = 24 hours
Location: worker/src/index.ts
Cost: zero. KV free tier is 100k reads/day, 1k writes/day.

---

## [x] Upgrade 3 — Apify Actor timeout increase  ← DONE 2026-03-19
Change the Actor timeout from 300 seconds to 3600 seconds in the Apify UI.
Apify console → Actor → Settings → Timeout → 3600
Playwright-based tools (extract_reddit, extract_yc, extract_producthunt) need
more than 5 minutes to launch Chromium and scrape. They will keep timing out
until this is changed. This is a UI field change, not a code change.
Cost: zero.

---

## [ ] Upgrade 4 — D1 deduplication in the cron job
Before inserting a new scrape result, check if the same source_url was already
stored in the last 24 hours. If yes, skip the insert.
Prevents the scrape_results table from filling with duplicate data across
consecutive cron runs, keeping the historical dataset clean for the intelligence
layer (Layer 7 in the roadmap).
Location: the cron job handler in the Worker code.
Cost: zero.

---

## [ ] Upgrade 5 — Structured JSON response form
Add the optional JSON form defined in FRESHCONTEXT_SPEC.md alongside the text
envelope in every adapter response. The JSON form has: source_url, content_date,
retrieved_at, freshness_confidence, adapter, freshness_score.
When a request has Accept: application/json, serve the structured form.
Both forms can be returned together — text for agents, JSON for programmatic use.
Location: src/tools/freshnessStamp.ts (same file as Upgrade 1, do together)
Cost: zero.

---

## [x] Upgrade 6 — GitHub Actions CI/CD automation  ← DONE 2026-03-19
.github/workflows/publish.yml created. Triggers on every push to main.
Runs npm ci → npm run build → npm publish using NPM_TOKEN secret.
continue-on-error on publish so doc-only pushes don't fail the workflow.
First run: green checkmark, 23 seconds.
Manual PowerShell build/publish commands no longer needed.

---

## [x] Upgrade 7 — server.json version sync  ← DONE 2026-03-19
server.json (MCP Registry listing) shows version 0.3.1 while package.json
is at 0.3.10. Anyone discovering FreshContext via the MCP Registry sees an
outdated version number. Fix by updating server.json manually now, then
optionally add a workflow step that syncs the version automatically on each
GitHub Actions run.
Location: server.json — change "version" field to match package.json.
Cost: zero.

---

## Priority order for remaining six upgrades

Do Upgrade 3 first — it is one UI field change and immediately fixes the
broken Apify Actor runs. Do Upgrades 1 and 5 together second since they
both touch freshnessStamp.ts and completing them makes FreshContext fully
spec-compliant. Do Upgrade 2 third — KV caching makes the Worker resilient
against upstream API instability. Do Upgrade 4 fourth — D1 deduplication
prepares the dataset for the future intelligence layer. Do Upgrade 7 last —
a simple version number correction, low urgency but worth keeping clean.
