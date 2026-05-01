# FreshContext — Launch Posts (2026-04-29, post-bot-filter)

**State at posting:**
- 975 signals scored at 100% DAR coverage
- 186 unique semantic fingerprints (~81% cross-adapter dedup)
- 18 watched queries on 6h cron, 57 days uptime
- Bot filter shipped today: errors down 87% in 6 hours
- Live: https://freshcontext-mcp.gimmanuel73.workers.dev

---

## Show HN — POST THIS ONE

**Title options (pick one):**

1. `Show HN: FreshContext – exponential decay scoring for retrieved web data`
2. `Show HN: I scored 975 web signals with R_t = R_0·e^(-λt) so my LLM stops citing dead jobs`
3. `Show HN: An MCP server that stamps every result with a freshness score and a SHA-256 receipt`

**Recommendation:** #1. Cleanest. HN titles do best when they describe what the thing is, not what it feels like.

---

**Body:**

LLMs treat retrieved web data as if every result is equally fresh. A job posted today and a job closed two years ago land in the context window with the same weight. The model has no way to tell the difference and confidently cites both.

FreshContext is an MCP server that fixes this by scoring every retrieved signal with exponential decay before the model sees it.

The math is one line:

    R_t = R_0 · e^(-λt)

R_0 is a semantic relevance score (0–100). λ is a per-source decay constant. t is hours since the content was actually published. R_t is the score the agent uses.

The λ values come from observing how long content from each source actually stays useful:

- Hacker News stories: λ = 0.05 → half-life ~14 hours
- Reddit, Product Hunt: λ = 0.010 → half-life ~3 days
- Job listings: λ = 0.005 → half-life ~6 days
- GitHub repos: λ = 0.0002 → half-life ~5 months
- arXiv, Scholar: λ = 0.00005 → half-life ~1.6 years

Each scored signal also carries:

- `published_at` extracted from the content itself (not assumed from retrieval time)
- `entropy_level` (low/stable/high) — which side of the decay curve the signal is on
- `ha_pri_sig` — SHA-256(result_id : content_hash : engine_version), so any answer citing the signal can be traced back to a tamper-evident row
- `semantic_fingerprint` — SHA-256(normalised_title | canonical_url | published_at), 16 chars, used to dedupe the same story across HN, Reddit, GitHub, and YC

Current state of the live system:

- 18 watched queries running on a 6-hour cron, 57 days of uptime
- 975 signals scored, 100% DAR coverage in the D1 ledger
- 186 unique semantic fingerprints from those 975 signals — ~81% of cross-adapter duplicates collapse correctly
- 20 source adapters, no API keys required for any of them
- Deployed on Cloudflare Workers, ~1ms median CPU, $5/month total infrastructure cost

The intelligence feed endpoint returns the scored, deduplicated signals directly:

    GET /v1/intel/feed/:profile_id?limit=20&min_rt=0

Full methodology, including the λ table and the audit-signature scheme, is in METHODOLOGY.md.

What I'd like feedback on:

1. The decay model is exponential and one-way. Real signals can re-ignite (a 3-year-old paper suddenly relevant again). I haven't solved this yet.
2. The λ constants are calibrated by intuition and source class, not by measuring real engagement decay. If you've done empirical decay-rate work, I want to read it.
3. Cross-adapter dedup is currently exact-match on the fingerprint. Near-duplicate stories (different titles, same event) still pass through.

Built solo from Grootfontein, Namibia. Spec is MIT. Code is open.

- Live endpoint: https://freshcontext-mcp.gimmanuel73.workers.dev
- GitHub: https://github.com/PrinceGabriel-lgtm/freshcontext-mcp
- npm: https://www.npmjs.com/package/freshcontext-mcp
- Methodology: https://github.com/PrinceGabriel-lgtm/freshcontext-mcp/blob/main/METHODOLOGY.md

---

## Why this version is different from the V9 draft

Removed:
- "Six months ago I asked Claude for a list of jobs" — anecdotal opener replaced with the systems framing HN expects
- "Stops being a tool and starts being infrastructure" — marketing language
- "The proprietary λ constants are the trade secret" — actively counter-productive on HN; replaced with publishing the actual values
- "Plus three things every signal carries that I haven't seen elsewhere" — claim without evidence; replaced with just describing them

Added:
- Real production numbers (975, 186, 100%, 81%, 57 days, ~1ms, $5/mo)
- The actual λ table with half-lives readers can sanity-check
- Three honest open problems at the bottom (HN rewards self-aware "here's what's broken" posts disproportionately)
- "No API keys required" stated plainly — this is unusual for MCP servers and worth flagging

Kept:
- One-line problem statement at the top
- The core math, formatted as code
- Grootfontein mention (once, not twice)
- Live URLs at the bottom

---

## Comment-thread prep

Likely questions and your honest answers. Have these ready in a notes file before posting.

**Q: Isn't this just RAG with a freshness filter?**
A: At one level yes. The difference is that the freshness signal is computed and stored at ingestion time per source, with the source-specific λ already applied, so the agent doesn't need to know the publication date — it gets a usable score directly. The agent can also filter by entropy_level which is something RAG pipelines don't typically expose.

**Q: Why exponential decay specifically?**
A: It matches how attention to most web content actually behaves — sharp early drop, long tail. Linear decay over-weights middle-aged content. Step functions create discontinuities. Exponential is the simplest model that doesn't get those wrong. Open to being shown a better one.

**Q: Where do the λ values come from?**
A: Observation, not measurement. That's a real limitation. A proper calibration would track engagement decay (clicks, citations, replies) per source class over time. I haven't built that yet.

**Q: 975 signals isn't much.**
A: Correct. 18 queries × 6h cron × 57 days × ~13 results per cycle, with dedup collapsing ~81% of duplicates. The dataset grows about 50–80 unique signals/day. The asset isn't the volume; it's the continuity and the per-row provenance.

**Q: Why MCP and not just an API?**
A: It's both — `/v1/intel/feed/:profile_id` is plain HTTP, the MCP transport at `/mcp` is for direct agent integration. MCP listing also gets it discovered by Claude Desktop, Cursor, etc. without anyone wiring up an integration.

**Q: What stops a competitor from copying this?**
A: The math, nothing — it's published. The λ calibration, time. The historical ledger, that's the actual moat — 57 days of timestamped signals you can't backfill.

**Q: Cloudflare Workers free tier?**
A: Hit the 100k req/day limit yesterday from bot scanning. On the $5/month plan now. Today shipped a path-and-UA-based bot filter that drops scanner traffic at 410 Gone before any KV/DB call. Errors dropped 87% in the 6 hours after deploy.

---

## Posting timing

**Best slots for Show HN, ordered:**
1. Tuesday 09:00–10:30 ET (= 15:00–16:30 CAT, your local Wed early afternoon)
2. Wednesday 09:00–10:30 ET (= 15:00–16:30 CAT)
3. Thursday 09:00–10:30 ET (slightly weaker)

**Avoid:** Friday afternoon, Saturday, Sunday, Monday morning. HN traffic is lowest then and your post will sink before the front-page algorithm sees it.

**Today's date is Wednesday 2026-04-29.** If you post in the next ~3 hours (it's 03:11 CAT, so US East Coast is just waking up), you hit Wednesday 09:00 ET head-on. That's the best slot of the week.

If you'd rather sleep on it, Tuesday next week is the next-best slot.

---

## After posting — first 4 hours

1. Open the HN post in one tab, your worker dashboard in another. Watch both.
2. Reply to every comment within ~30 minutes. Thoughtful, technical, no defensiveness.
3. If someone reports a bug, fix it that day. Reply to their comment with a link to the commit.
4. If the post hits front page, don't celebrate publicly on HN. Reply to comments. Stay technical.
5. Save the full comment thread to `LAUNCH_FEEDBACK.md` once it cools off. That's your roadmap for the next 4 weeks.

**If it doesn't hit front page:** that's normal. ~85% of Show HN posts don't. The signal you want is *quality of the comments you do get*, not volume. Two thoughtful replies from infra engineers > 200 upvotes from drive-by readers.

---

## LinkedIn — post 24h after HN, NOT before

Saving this for tomorrow. Reason: if LinkedIn drives traffic during the HN window, you can't tell which channel is working. Stagger.

(LinkedIn draft same as in LAUNCH_POSTS_V9.md — works as-is. Update the numbers to match the Show HN post: 975 signals, 186 fingerprints, 81% dedup, 57 days uptime.)

---

## Twitter/X — same day as LinkedIn

(Thread draft same as in LAUNCH_POSTS_V9.md — works as-is. Same number updates.)

---

*Drafted 2026-04-29 03:15 CAT. Post within 3 hours for Wednesday 09:00 ET window, or wait till Tuesday next week.*
