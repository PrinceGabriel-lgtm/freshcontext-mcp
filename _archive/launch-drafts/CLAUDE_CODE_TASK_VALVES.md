# Claude Code Task Brief — Defensive Valves for intelligence.ts

**Date prepared:** 2026-05-01
**Author:** Prince Gabriel
**Purpose:** Hand to Claude Code for execution. Read carefully before pasting.

---

## How to use this file

1. Open Claude Code in the repo root: `cd C:\Users\Immanuel Gabriel\Downloads\freshcontext-mcp; claude`
2. Trust the folder when prompted.
3. Paste the **PROMPT** section below into Claude Code (everything between the `=== PROMPT START ===` and `=== PROMPT END ===` markers, exclusive).
4. Watch what it does. It will pause and ask for confirmation at multiple checkpoints. **DO NOT type "yes to all"** — read each diff before approving.
5. When it finishes, close Claude Code with `exit` or Ctrl+C twice.

---

## What this task does

Adds three defensive safety valves to `worker/src/intelligence.ts`:

1. **Clock skew rejection** — reject signals whose `published_at` is more than 5 minutes in the future
2. **Hard floor** — flag signals with `R_t < 5` as expired so they can be pruned
3. **Lazy decay computation** — the cron writes once at ingestion, retrieval recomputes R_t fresh per request

These come from the stress-test analysis we documented earlier. They don't change the math — they harden it against bad input and runaway compute.

## What this task does NOT do

- Does not refactor anything outside `worker/src/intelligence.ts` and `worker/src/worker.ts`
- Does not touch the cron schedule
- Does not modify the database schema (existing columns are sufficient)
- Does not change the public API contract
- Does not deploy

## Scope boundary (the most important section)

**The agent is forbidden from:**
- Modifying any file outside `worker/src/`
- Running `git add` against any path that includes `Downloads`, `Documents`, `.api-key.local.txt`, `.mcpregistry_*`, `mcp-publisher.exe`, `backup.sql`, `node_modules`, `.wrangler`, or `_archive`
- Running `git push` (the user pushes manually)
- Running `wrangler deploy` (the user deploys manually)
- Running `npm publish` (CI handles this)
- Running `apify push` (separate task)
- Touching anything in `C:\Users\Immanuel Gabriel\Downloads\` outside `freshcontext-mcp\`
- Adding new dependencies to `package.json`
- Creating new files outside `worker/src/`

If the agent suggests doing any of the above, **stop the conversation and refuse**.

---

=== PROMPT START ===

You are working in the `freshcontext-mcp` repository on a contained engineering task. Read `CLAUDE.md` first if you haven't already. Then read this brief in full before taking any action.

## Goal

Add three defensive valves to the DAR engine in `worker/src/intelligence.ts`:

1. **Clock skew rejection** — `published_at` more than 5 minutes in the future is invalid. Return null + log; do not score.
2. **Hard floor** — when `R_t < 5`, set `is_expired = true` so cron can prune dead signals.
3. **Lazy decay** — currently `cron` writes `rt_score` once at ingestion. Change retrieval (in `worker.ts`, the `/v1/intel/feed/:profile_id` handler) to recompute `R_t` from `base_score`, `published_at`, and the source's λ at request time. The stored `rt_score` becomes the value-at-write-time historical record; the *served* value is always fresh.

## Hard constraints (do not violate)

1. **You may only edit:** `worker/src/intelligence.ts` and `worker/src/worker.ts`. Nothing else.
2. **You may NOT run:**
   - `git push`
   - `wrangler deploy`
   - `npm publish`
   - Any command containing `apify`
   - `git add .` or `git add -A` (always specify exact paths)
3. **You may NOT add new files** outside the two listed above.
4. **You may NOT add new npm dependencies.**
5. **You may NOT modify the database schema.** The existing columns (`is_expired` may need adding via migration; if so, STOP and ask me first — do not write a migration without my confirmation).
6. **Before every commit, show me `git diff --cached`** and wait for me to type "commit" before running `git commit`.

## Process I want you to follow

### Step 1 — Read first
- Read `worker/src/intelligence.ts` end to end.
- Read `worker/src/worker.ts` end to end (it's long; that's expected).
- Tell me in plain English: where the cron writes `rt_score`, where the feed reads it, and whether `is_expired` already exists as a column.

### Step 2 — Plan
- Tell me which functions you'll modify, what their signatures will become, and what the smallest possible diff looks like.
- Do not start writing code yet. Wait for me to say "go ahead."

### Step 3 — Implement
Once I approve the plan:
- Make the smallest possible changes to implement valves 1, 2, and 3.
- Add unit-style sanity checks as inline comments, not as new test files.
- Preserve the existing function signatures where possible. If a signature must change, mention it.

### Step 4 — Verify locally
- Run `cd worker && npx tsc --noEmit` to verify TypeScript compiles. Show me the output.
- If it errors, fix and retry.
- Do NOT deploy. Do NOT push.

### Step 5 — Stage and show diff
- `git add worker/src/intelligence.ts worker/src/worker.ts` (only those two files)
- Run `git diff --cached` and show me the full diff.
- Wait for me to type "commit" before doing anything else.

### Step 6 — Commit (only after I say "commit")
- Use this commit message: `feat: defensive valves — clock skew rejection + hard floor + lazy decay at read time`
- Do NOT push. I will push manually after I review.

## Acceptance criteria

You're done when:
- `worker/src/intelligence.ts` has clock skew rejection in `applyDecay` (or a new `applyDefensiveDecay` if cleaner), and a `is_expired` boolean in its return shape.
- `worker/src/worker.ts` `/v1/intel/feed/*` handler computes `rt_score` fresh per request from stored base values rather than reading the cron-written `rt_score` column.
- `npx tsc --noEmit` passes from the `worker/` directory.
- The commit is staged but not pushed.
- You did not modify any file outside the two permitted ones.

## When to stop and ask

- If `is_expired` doesn't exist as a D1 column and adding it would require a migration → STOP, ask me. (We can either add a migration with explicit approval, or use the rt_score < 5 condition at read time without a column.)
- If the lazy decay change requires changing a function signature that's called from more places than just the feed handler → STOP, list the call sites, ask me how to handle each one.
- If TypeScript fails to compile after your changes and you can't fix it within 3 attempts → STOP, show me the error, ask for guidance.
- If you encounter ANY situation where the right move is to modify a file outside `worker/src/` → STOP, ask me first.

## What I will do after you finish

- Review your diff
- If good, type "commit"
- After commit, I'll run `wrangler deploy` and `git push origin main` myself
- I'll verify the live worker still scores signals correctly

That's the whole task. Be careful. Show your work.

=== PROMPT END ===

---

## Notes for me (Prince) — not to paste

**Why this prompt is structured the way it is:**

- The "Hard constraints" section uses the word "NOT" in caps because Claude Code respects negative constraints better when they're visually emphasized.
- The step-by-step process forces it to pause at known checkpoints (read → plan → implement → verify → stage → commit). Each pause is a chance to catch something going off-rails.
- The "When to stop and ask" section gives it explicit permission to stop. Without that, agents tend to power through ambiguity rather than ask, which is how runaway changes happen.
- The "What I will do after you finish" section makes it clear I'm taking the irreversible actions (push, deploy), not the agent.

**The "I pushed my whole Downloads folder to Cloudflare" prevention strategy:**

- The constraint list explicitly forbids `git add .` and `git add -A`
- It forbids any command touching `Downloads` outside the project folder
- It forbids `wrangler deploy` entirely (only you can deploy)
- It restricts file writes to two specific files

If Claude Code at any point says something like "I'll just `git add .` to make sure I get everything" — say no, ask it to specify exact paths. That single command pattern is what causes the worst accidents.

**If something goes wrong:**

- `git status` shows you what's staged
- `git restore --staged <file>` unstages
- `git restore <file>` reverts uncommitted changes in working tree
- If you've already committed locally but not pushed: `git reset --soft HEAD~1` undoes the commit but keeps the changes
- If something got pushed by mistake — that's why we're being careful here

**After this task is done:**

The next contained tasks Claude Code can handle, in order of decreasing safety:
1. Add `"skipLibCheck": true` to `tsconfig.json` (one-line change, low risk)
2. Write `RISKS.md` documenting the stress-test failure modes (text-only, zero risk)
3. The Apify rebuild — but this one we should do together carefully because `apify push` is a deploy

Don't hand Claude Code multiple of these at once. One task per session. Watch each one.
