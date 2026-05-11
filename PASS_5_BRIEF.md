# Pass 5 — Spec Completion: Worker Envelope Parity

## Context

The FreshContext spec (`FRESHCONTEXT_SPEC.md`, `METHODOLOGY.md`) defines a two-part output:

1. A human-readable text envelope `[FRESHCONTEXT]…[/FRESHCONTEXT]` with a numeric `Score: N/100 (<label>)` line.
2. A machine-parseable `[FRESHCONTEXT_JSON]…[/FRESHCONTEXT_JSON]` block containing the same metadata as a JSON object.

The npm package (`src/tools/freshnessStamp.ts`) implements both — `formatForLLM()` emits the envelope plus JSON block, and `toStructuredJSON()` builds the structured form. The DAR engine (`λt`) is applied via per-adapter decay rates baked into `freshnessStamp.ts`.

**The deployed Worker is one revision behind the spec.** `worker/src/worker.ts:190-207` defines a simpler `stamp()` helper that emits only the `[FRESHCONTEXT]` text envelope. It does not compute or render `freshness_score`, and it does not emit the `[FRESHCONTEXT_JSON]` block. All 21 tools call this `stamp()`, so 21 endpoints are spec-incomplete on the live worker.

**Goal:** Bring the Worker's envelope to spec parity with the npm package. End state: every tool response from `/mcp` includes a `Score: N/100 (<label>)` line and a trailing `[FRESHCONTEXT_JSON]` block. No new tools, no new endpoints — the change is one function (`stamp`) and possibly one helper for decay rate.

This is a prerequisite for Pass 9 (dashboard) — the dashboard wants `freshness_score` as a number to render bars/colors.

## Required reading before starting

1. `src/tools/freshnessStamp.ts` — reference implementation. Note: `DECAY_RATES`, `calculateFreshnessScore`, `scoreLabel`, `formatForLLM`, `toStructuredJSON`.
2. `worker/src/worker.ts:190-207` — current `stamp()`.
3. `worker/src/intelligence.ts` — DAR engine. Don't modify. Confirm whether the decay rates here align with the npm package's table (they should; if they don't, raise it).
4. `FRESHCONTEXT_SPEC.md` — the contract.

## Task — two phases. Stop and report between them.

### PHASE 1 — Audit (read-only)

For the Worker:

1. Confirm the gap: does *every* tool path call `stamp()`? Are there any direct envelope strings written elsewhere (composites, briefing, intel feed)?
2. Compare DAR decay rates between `src/tools/freshnessStamp.ts` (`DECAY_RATES`) and `worker/src/intelligence.ts`. They must agree. If they disagree, list the differences and flag — do not fix in Phase 1.
3. Check every adapter name passed to `stamp()` (in worker.ts) against the DAR rate table. Pass 4 Phase 2 fixed one (`yahoo_finance` → `finance`). Sweep the remaining 20 to confirm none silently fall through to default rate `1.5`.
4. Spot anywhere downstream that parses the envelope (e.g. cron job, intel feed, briefing synthesis) and might break if a `Score:` line and a trailing `[FRESHCONTEXT_JSON]` block are appended. Listing-only — do not change.

**Output of Phase 1:** Markdown report `AUDIT_PASS5.md` at repo root. Include:
- Diff between current `stamp()` and target spec (annotated).
- DAR decay-rate parity table (npm vs worker).
- List of adapter names used in `stamp()` calls and whether each is in the rate table.
- Any downstream parsers that need to be checked for compatibility.
- Total stamp() call sites count.

Stop and wait for review.

### PHASE 2 — Implement parity

After human review:

1. Update `worker/src/worker.ts` `stamp()` to:
   - Compute `freshness_score` using the same logic as `freshnessStamp.ts:calculateFreshnessScore`.
   - Include a `Score: N/100 (<label>)` line in the text envelope, between `Confidence:` and `---`.
   - Use the same labels: ≥90 "current", ≥70 "reliable", ≥50 "verify before acting", else "use with caution", null → "unknown".
   - Append a `[FRESHCONTEXT_JSON]…[/FRESHCONTEXT_JSON]` block with the structured object after `[/FRESHCONTEXT]`.
2. Add a small `DECAY_RATES` table local to worker.ts OR import it cleanly from a shared module — pick whichever yields the smaller diff.
3. Fix any adapter-name mismatches found in Phase 1 (one-line typo fixes).
4. Run `npx tsc --noEmit` from `worker/`.
5. Deploy: `npx wrangler deploy`.
6. Verify: curl one fast tool (e.g. `extract_hackernews` with an Algolia URL) through `/mcp` and confirm:
   - The text envelope has a `Score: N/100 (<label>)` line.
   - A `[FRESHCONTEXT_JSON]` block follows it with parseable JSON.
7. Commit: `feat(pass-5): worker envelope parity — freshness_score numeric + structured JSON block`.
8. Report version ID and a sample tool output.

## Boundaries

- **Do not** change the DAR decay rates themselves (the rates in `intelligence.ts` and `freshnessStamp.ts` are the spec — if they disagree, raise it for human decision, do not arbitrate).
- **Do not** change tool inputs, outputs structure, or tool names. The change is purely additive: same envelope plus two new pieces.
- **Do not** modify the cron job, `/v1/intel/feed`, briefing synthesis, or the demo route in this pass.
- **Do not** touch the npm package — it already has the spec implementation.
- **Do** keep the diff small. The intent is "port one function" — anything beyond that is scope creep.
- **Do** stop between phases for review.

## When done

Reply with:
1. Worker version ID from the deploy.
2. Sample envelope output from one tool, showing the new `Score:` line and `[FRESHCONTEXT_JSON]` block.
3. Any decay-rate divergences found and how they were resolved (if at all).
4. Any adapter-name mismatches fixed.
5. Confirmation that the existing 21 tools all still respond.
