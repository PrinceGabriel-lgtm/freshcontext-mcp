# FreshContext Project Context Skill

## Purpose
Generate a compressed, structured context map of the FreshContext project state. Used at the start of new sessions to restore working context without re-reading full session saves. Reduces token usage by ~70% compared to full session save parsing.

## When to use
- Start of any new chat session on the FreshContext project
- When context window is filling up and compression is needed
- When asked to "load context", "restore state", or "what are we working on"

## Output format

Generate a context map in this structure:

```
PROJECT: FreshContext MCP
STATE: [one line — what's live vs pending]

CORE FILES:
- worker/src/intelligence.ts  [DAR engine — exponential decay scoring]
- worker/src/worker.ts        [Cloudflare Worker — all endpoints + cron]
- worker/src/synthesize.ts    [Claude briefing synthesis — paused, needs key]
- METHODOLOGY.md              [formal IP documentation]
- FRESHCONTEXT_SPEC.md        [open standard v1.1]

INFRASTRUCTURE:
- Worker: https://freshcontext-mcp.gimmanuel73.workers.dev [LIVE]
- D1: freshcontext-db (d9898d65-f67e-4dcb-abdc-7f7b53f2d444) [LIVE]
- KV: RATE_LIMITER + CACHE [LIVE]
- Cron: 0 */6 * * * [RUNNING]
- npm: freshcontext-mcp@0.3.15 [LIVE]

ENDPOINTS:
/mcp                      — MCP transport (all tools)
/briefing                 — GET latest stored briefing
/briefing/now             — POST force scrape + synthesize
/watched-queries          — GET list all watched queries
/v1/intel/feed/:id        — GET DAR-scored intelligence feed
/debug/db                 — GET D1 counts + recent scores
/debug/scrape             — GET run one adapter raw

DAR ENGINE (intelligence.ts):
R_t = R_0 · e^(-λt)
λ: HN=0.050 Reddit=0.010 Jobs=0.005 Finance=0.001 GitHub=0.0002 Scholar=0.00005
Outputs: base_score, rt_score, entropy(low/stable/high), ha_pri_sig, published_at, semantic_fingerprint

D1 SCHEMA additions (idempotent on every cron):
base_score, rt_score, ha_pri_sig, entropy_level, published_at, semantic_fingerprint

KNOWN ISSUES:
- 12 TS type errors in worker.ts (type:"string" not literal "text") — wrangler deploys fine
- 130 node_modules conflicts (workers-types vs @types/node) — cosmetic
- Fix: add "skipLibCheck": true to tsconfig.json

BLOCKED ON:
- ANTHROPIC_KEY: not set — formatBriefing() fallback active
- Paddle verification: pending

NEXT BUILD PRIORITIES:
1. Webhook/trigger system — push signals when rt_score > threshold
2. Mining/industrial domain watched queries
3. Profile population (user_profiles table exists, nothing writes to it)
4. skipLibCheck tsconfig fix

COMMITS (current):
- d330dc3: DAR engine + intel feed endpoint
- a965554: ToolResult type fix + SESSION_SAVE_V9
- b9df76b: semantic deduplication + METHODOLOGY.md

AUTHOR: Immanuel Gabriel · Grootfontein, Namibia · gimmanuel73@gmail.com
```

## Instructions for Claude

At session start:
1. Read SESSION_SAVE_V9.md for detailed state
2. Output the context map above — compressed, no prose
3. Ask: "What are we working on today?"

Mid-session update: revise only changed fields. Don't regenerate the full map.

## Token budget
Full session save: ~2,500 tokens. This map: ~400 tokens.
Use this for orientation. Use session saves only for deep debugging.
