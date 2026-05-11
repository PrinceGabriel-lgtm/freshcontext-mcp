# Pass 4 — Adapter Audit & Worker Wiring

## Context

FreshContext is a temporal correction layer for AI retrieval. Repo: `freshcontext-mcp`.

The codebase has **16 base adapter source files** (`arxiv, changelog, finance, gdelt, gebiz, github, govcontracts, hackernews, jobs, packageTrends, productHunt, reddit, repoSearch, scholar, secFilings, yc`) and **5 composite tools** (`extract_landscape, extract_gov_landscape, extract_finance_landscape, extract_company_landscape, extract_idea_landscape`).

**Currently:**
- `worker/src/worker.ts` (deployed Cloudflare Worker) registers only 11 tools.
- `src/server.js` (npm package) registers 17 tools but is missing 4 base adapters from `registerTool` calls (`finance, reddit, arxiv, producthunt`) — source files exist, just aren't wired.
- `apify.js` handles 16 base adapters, no composites.

**Goal:** Wire all 16 base adapters + 5 composites into the Worker. End state: 21 tools live on `https://freshcontext-mcp.gimmanuel73.workers.dev/mcp`.

## Required reading before starting

1. `FRESHCONTEXT_SPEC.md` — the envelope contract
2. `METHODOLOGY.md` — DAR engine + freshness scoring
3. `worker/src/worker.ts` — current state, see how the 11 existing tools are registered
4. `worker/src/intelligence.ts` — DAR engine (don't modify)
5. `src/tools/freshnessStamp.ts` — the function adapters call to wrap output in envelope (don't modify)

## Task — three phases. Do them in order. Report between phases.

### PHASE 1 — Audit (read-only, no edits)

For each of the 16 base adapter files in `src/adapters/`, document:

| Adapter | Wired in worker.ts? | Wired in server.js? | Output: proper envelope or raw? | Known bugs |
|---|---|---|---|---|

**Specifically check:**
- Does the adapter call `stampFreshness()` on its output? Or does it just return raw text with dates embedded inline?
- Does `content_date` come through as a structured field, or is it stuffed into the content string?
- Does `freshness_confidence` get set (`high` / `medium` / `low`)?
- Does the adapter return errors gracefully or throw?

**Two known bugs to verify:**
1. `extract_govcontracts` — historical USASpending.gov API issue (sort field was `Award_Amount`, had to change to `Award ID`). Confirm current code uses correct field. Test by running the adapter against a known company name.
2. `extract_hackernews` — past output showed timestamps embedded inline in content string (`"... -- 2026-02-06T18:48:03Z ..."`) rather than as a structured envelope field. Check if this still happens.

**Output of Phase 1:** Markdown table written to `AUDIT_PASS4.md` at repo root. Include any other bugs you find. **Do not edit any source files yet.** Stop and report.

### PHASE 2 — Fix the bugs found in Phase 1

After human review of `AUDIT_PASS4.md`:
- Fix any adapter that emits raw timestamps instead of envelopes
- Fix `extract_govcontracts` if the sort field is wrong
- Fix any other clear bugs surfaced
- Add the 4 missing `registerTool` calls in `src/server.js` (`finance, reddit, arxiv, producthunt`)
- Run `npm run build` and confirm no TypeScript errors

**Output of Phase 2:** A commit titled `fix: adapter envelope compliance + missing server.js registrations`. Stop and report.

### PHASE 3 — Wire everything into the Worker

Port the 5 unwired adapters from `src/adapters/` to `worker/src/tools/` (or wherever the existing 11 worker tools live — match the existing pattern):
- `arxiv`
- `changelog`
- `finance` (note: `extract_finance` may need `BROWSER` binding in wrangler.jsonc — check)
- `gdelt`
- `gebiz`
- `govcontracts`
- `producthunt`
- `reddit`
- `secFilings`

Then port all 5 composites:
- `extract_landscape`
- `extract_gov_landscape`
- `extract_finance_landscape`
- `extract_company_landscape`
- `extract_idea_landscape`

**For each, register it in `worker/src/worker.ts`** in the MCP tool list following the existing pattern.

**Critical constraints:**
- Do not break the 11 tools currently working.
- Do not modify `intelligence.ts` (DAR engine), `worker.ts` defensive valves block, the `/demo` route, or anything in `demo/`.
- Composites must use `Promise.allSettled` (partial failures must not collapse the whole call).
- All adapters MUST output proper FreshContext envelopes — verified in Phase 1.
- Worker has a `BROWSER` binding for Playwright-style scraping; some adapters will need it (check existing tool implementations for the pattern).

After porting:
1. Run `npx tsc --noEmit` from `worker/` — must pass with zero errors.
2. Run `npx wrangler deploy` from `worker/`.
3. Verify with `curl -X POST https://freshcontext-mcp.gimmanuel73.workers.dev/mcp -H "Content-Type: application/json" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'` — should return 21 tools.

**Output of Phase 3:** Commit titled `feat(pass-4): wire all 16 base adapters + 5 composites into Worker (11→21 tools)`. Push to `main`. Report final tool count from the `tools/list` response.

## Boundaries

- **Do not** propose architectural changes (vector DB, agent loop, multi-tenancy, module restructure). Pass 4 is mechanical wiring + bug fixes only.
- **Do not** modify the AgenticMarket listing, README, or any marketing copy.
- **Do not** touch the `apify-legacy` branch.
- **Do** ask for human input if you find a bug whose fix isn't obvious or would require a design decision.
- **Do** stop between phases for review. Don't run all three end-to-end without checkpoints.
- **Do** keep commits small and focused. One commit per phase minimum.

## When done

Reply with:
1. Final tool count from `tools/list`
2. List of bugs fixed
3. Any adapters that couldn't be wired and why
4. Worker version ID from the deploy output
