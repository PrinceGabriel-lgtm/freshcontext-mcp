# freshcontext-mcp

I asked Claude to help me find a job. It gave me a list of openings. I applied to three of them. Two didn't exist anymore. One had been closed for two years.

Claude had no idea. It presented everything with the same confidence.

That's the problem freshcontext fixes.

[![npm version](https://img.shields.io/npm/v/freshcontext-mcp)](https://www.npmjs.com/package/freshcontext-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![MCP Registry](https://img.shields.io/badge/MCP%20Registry-Listed-blue)](https://registry.modelcontextprotocol.io)

> **Live demo:** [freshcontext-mcp.gimmanuel73.workers.dev/demo](https://freshcontext-mcp.gimmanuel73.workers.dev/demo) — same model, same query, two completely different answers. Only the temporal layer changed.

---

## The problem

Large language models retrieve web data semantically. Cosine similarity finds the documents that match a query best — but cosine doesn't know when a document was written.

So a 2022 blog post and a 2026 paper can score nearly identically. The model gets a context window full of stale documents and faithfully summarizes 2022 advice for a 2026 question.

That's not hallucination. That's correct summarization of corrupted retrieval.

> **Most RAG pipelines rank context correctly semantically but incorrectly temporally.**

---

## The layer

FreshContext is a **temporal correction layer for retrieval systems**. One math correction applied before context reaches the LLM:

```
R_t = R_0 · e^(−λt)
```

- `R_0` — base semantic relevancy (whatever your retriever already gives you)
- `λ` — source-specific decay constant (HN ≈14h half-life, blogs ≈29d, academic papers ≈1.6y)
- `t` — hours elapsed since publication
- `R_t` — decay-adjusted relevancy at query time

That's the whole fix. No model swap. No re-embedding. No re-indexing. The layer drops onto whatever retrieval pipeline you already have.

**The layer is the product.** The 21 tools shipped with this repo are reference adapters demonstrating compatibility — useful, but commodity. The DAR engine, the freshness envelope, and the FreshContext Specification are the moat.

---

## The standard

Every FreshContext-compatible response wraps content in a structured envelope:

```
[FRESHCONTEXT]
Source: https://github.com/owner/repo
Published: 2024-11-03
Retrieved: 2026-03-05T09:19:00Z
Confidence: high
---
... content ...
[/FRESHCONTEXT]
```

**When** it was retrieved. **Where** it came from. **How confident** we are the date is accurate.

The FreshContext Specification v1.2 is published as an open standard under MIT licence. Any tool, agent, or system that wraps retrieved data in this envelope is FreshContext-compatible. → [Read the spec](./FRESHCONTEXT_SPEC.md) · [Read the methodology](./METHODOLOGY.md)

---

## Architecture boundary

FreshContext Core is the reusable engine. It owns freshness scoring, envelope formatting, failure guards, shared types, rank/explain primitives, and the context-conditioned utility primitive.

MCP is one interface over Core. Claude Desktop is supported, but not required. The 21 MCP tools in this repo are reference adapters and a live interface for using the system.

The production Cloudflare Worker now uses Core-backed envelope generation. Worker-specific concerns remain outside Core: MCP transport, runtime guards, KV cache policy, cache metadata injection, JSON parse/replace cache helpers, D1 feeds, cron, rate limiting, and Store/feed scoring/provenance.

---

## The intelligence feed

Beyond the per-call envelope, the production FreshContext deployment exposes a continuous, decay-scored, deduplicated feed:

```
GET /v1/intel/feed/:profile_id?limit=20&min_rt=0
```

Every signal is stamped with `base_score`, `rt_score`, `entropy_level` (low / stable / high), `ha_pri_sig` (Ha-Pri v1 SHA-256 provenance reference), `semantic_fingerprint` (cross-adapter dedup), and `published_at`. Ready for direct LLM or agent consumption — no synthesis required.

Production endpoint: `https://freshcontext-mcp.gimmanuel73.workers.dev`

---

## Reference adapters

The repo ships 21 tools demonstrating how to make any data source FreshContext-compatible. Useful as drop-in tools, but the value is the layer above them.

### Intelligence
| Adapter | What it returns |
|---|---|
| `extract_github` | README, stars, forks, language, topics, last commit |
| `extract_hackernews` | Top stories or search results with scores and timestamps |
| `extract_scholar` | Research papers — titles, authors, years, snippets |
| `extract_arxiv` | arXiv papers via official API |
| `extract_reddit` | Posts and community sentiment from any subreddit |

### Competitive research
| Adapter | What it returns |
|---|---|
| `extract_yc` | YC company listings by keyword |
| `extract_producthunt` | Recent launches by topic |
| `search_repos` | GitHub repos ranked by stars with activity signals |
| `package_trends` | npm and PyPI metadata — version history, release cadence |

### Market data
| Adapter | What it returns |
|---|---|
| `extract_finance` | No-key Stooq quote data — close, OHLC, volume, quote timestamp, source. Up to 5 tickers. |
| `search_jobs` | Remote job listings from Remotive, RemoteOK, HN "Who is Hiring" |

### Composites — multiple sources, one call
| Adapter | Sources | Purpose |
|---|---|---|
| `extract_landscape` | 6 | YC + GitHub + HN + Reddit + Product Hunt + npm in parallel |
| `extract_idea_landscape` | 6 | HN + YC + GitHub + Jobs + npm + Product Hunt — full idea validation |
| `extract_gov_landscape` | 4 | Gov contracts + HN + GitHub + changelog |
| `extract_finance_landscape` | 5 | Finance + HN + Reddit + GitHub + changelog |
| `extract_company_landscape` | 5 | The full picture on any company |

### Unique — not available in any other MCP server
| Adapter | Source | What it returns |
|---|---|---|
| `extract_changelog` | GitHub Releases / npm / auto-discover | Update history from any repo, package, or website |
| `extract_govcontracts` | USASpending.gov | US federal contract awards — company, amount, agency, period |
| `extract_sec_filings` | SEC EDGAR | 8-K filings — legally mandated material event disclosures |
| `extract_gdelt` | GDELT Project | Global news intelligence — 100+ languages, 15-min updates |
| `extract_gebiz` | data.gov.sg | Singapore Government procurement tenders — open dataset |

---

## Quick start

### Cloud (no install)

Add to your Claude Desktop config and restart:

**Mac:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "freshcontext": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://freshcontext-mcp.gimmanuel73.workers.dev/mcp"]
    }
  }
}
```

Restart Claude. Done.

> Prefer a guided setup? Visit **[freshcontext-site.pages.dev](https://freshcontext-site.pages.dev)** — 3 steps, no terminal.

### Local (full Playwright)

**Requires:** Node.js 20+ ([nodejs.org](https://nodejs.org))

```bash
git clone https://github.com/PrinceGabriel-lgtm/freshcontext-mcp
cd freshcontext-mcp
npm install
npx playwright install chromium
npm run build
```

Add to Claude Desktop config:

**Mac:**
```json
{
  "mcpServers": {
    "freshcontext": {
      "command": "node",
      "args": ["/Users/YOUR_USERNAME/path/to/freshcontext-mcp/dist/server.js"]
    }
  }
}
```

**Windows:**
```json
{
  "mcpServers": {
    "freshcontext": {
      "command": "node",
      "args": ["C:\\Users\\YOUR_USERNAME\\path\\to\\freshcontext-mcp\\dist\\server.js"]
    }
  }
}
```

#### Mac troubleshooting

**"command not found: node"** — Use the full path:
```bash
which node  # copy this output, replace "node" in config
```

**Config file doesn't exist:**
```bash
mkdir -p ~/Library/Application\ Support/Claude
touch ~/Library/Application\ Support/Claude/claude_desktop_config.json
```

---

## Usage examples

**Should I build this idea?**
```
Use extract_idea_landscape with idea "procurement intelligence saas"
```
Returns funding signal, pain signal, crowding signal, market signal, ecosystem signal, and launch signal — all timestamped.

**Full company intelligence in one call:**
```
Use extract_company_landscape with company "Palantir" and ticker "PLTR"
```
SEC filings + federal contracts + global news + changelog + market data.

**Did that company just disclose something material?**
```
Use extract_sec_filings with url "Palantir Technologies"
```
8-K filings are legally mandated within 4 business days of any material event — CEO change, acquisition, breach, major contract.

**Is this dependency still actively maintained?**
```
Use extract_changelog with url "https://github.com/org/repo"
```
Returns the last 8 releases with exact dates. If the last release was 18 months ago, you'll know before you pin the version.

---

## Deployment & infrastructure

The reference implementation runs on Cloudflare's global edge:

| Endpoint | Method | Purpose |
|---|---|---|
| `/` | GET | Service info + endpoint list |
| `/health` | GET | Liveness check |
| `/mcp` | POST | MCP JSON-RPC transport |
| `/demo` | GET | Live before/after demo (no API key required) |
| `/briefing` | GET | Latest stored briefing |
| `/v1/intel/feed/:profile_id` | GET | DAR-scored intelligence feed |
| `/watched-queries` | GET | List all watched queries |

- **D1 database** — 18 watched queries running on 6-hour cron with relevancy scoring
- **KV-backed rate limiting** — 60 req/min per IP across all edge nodes
- **Defensive valves** — clock-skew rejection (5min tolerance), hard floor at R_t<5, lazy decay at read time
- **Provenance** — Ha-Pri v1 SHA-256 provenance stamps on stored signals; hard tamper enforcement is a future Ha-Pri v2 path
- **Schema migrations** — promise-gated, idempotent, run on first request after deploy

Production: `https://freshcontext-mcp.gimmanuel73.workers.dev`

---

## Roadmap

- [x] FreshContext Specification v1.2 published (MIT, open standard)
- [x] DAR engine with proprietary λ constants (v0.3.17)
- [x] Ha-Pri v1 provenance signatures on stored signals
- [x] Semantic deduplication via fingerprinting
- [x] Live before/after demo at `/demo`
- [x] METHODOLOGY.md — formal IP and engineering documentation
- [x] 21 reference tools across intelligence, competitive research, market data, and composites
- [x] Core-backed envelope generation shared by npm/MCP and the Cloudflare Worker
- [x] Cloudflare Workers deployment — global edge, KV cache, KV rate limiting
- [x] Listed on official MCP Registry, Apify Store, npm
- [ ] Ha-Pri v2 hardened canonical content hash verification
- [x] GitHub Actions CI/CD — auto-publish on every push
- [ ] Webhook triggers — push high-entropy signals on threshold
- [ ] Dashboard — React frontend for the D1 intelligence pipeline
- [ ] GKG upgrade for `extract_gdelt` — tone scores, goldstein scale, event codes

---

## Contributing

PRs welcome. New adapters are the highest-value contribution — see `src/adapters/` for the pattern and [`FRESHCONTEXT_SPEC.md`](./FRESHCONTEXT_SPEC.md) for the contract any adapter must fulfil.

If you're building something FreshContext-compatible, open an issue and we'll add you to the ecosystem list.

---

## License

MIT

---

*Built by Prince Gabriel — Grootfontein, Namibia 🇳🇦*
*"The work isn't gone. It's just waiting to be continued."*

---

**Also on:** [Apify Store](https://apify.com/prince_gabriel/freshcontext-mcp) · [MCP Registry](https://registry.modelcontextprotocol.io) · [npm](https://www.npmjs.com/package/freshcontext-mcp)
