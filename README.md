# freshcontext-mcp

I asked Claude to help me find a job. It gave me a list of openings. I applied to three of them. Two didn't exist anymore. One had been closed for two years.

Claude had no idea. It presented everything with the same confidence.

That's the problem freshcontext fixes.

[![npm version](https://img.shields.io/npm/v/freshcontext-mcp)](https://www.npmjs.com/package/freshcontext-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![MCP Registry](https://img.shields.io/badge/MCP%20Registry-Listed-blue)](https://registry.modelcontextprotocol.io)

---

## The Standard

FreshContext is a **data freshness layer for AI agents** — an open standard and reference implementation that makes retrieved data trustworthy.

Every piece of web data an AI agent retrieves has an age. Most tools ignore it. FreshContext surfaces it — wrapping every result in a structured envelope that carries three guarantees:

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

The FreshContext Specification v1.1 is published as an open standard under MIT license. Any tool, agent, or system that wraps retrieved data in this envelope is FreshContext-compatible. → [Read the spec](./FRESHCONTEXT_SPEC.md)

---

## 20 tools. No API keys.

### Intelligence
| Tool | What it gets you |
|---|---|
| `extract_github` | README, stars, forks, language, topics, last commit |
| `extract_hackernews` | Top stories or search results with scores and timestamps |
| `extract_scholar` | Research papers — titles, authors, years, snippets |
| `extract_arxiv` | arXiv papers via official API — more reliable than Scholar |
| `extract_reddit` | Posts and community sentiment from any subreddit |

### Competitive research
| Tool | What it gets you |
|---|---|
| `extract_yc` | YC company listings by keyword — who's funded in your space |
| `extract_producthunt` | Recent launches by topic |
| `search_repos` | GitHub repos ranked by stars with activity signals |
| `package_trends` | npm and PyPI metadata — version history, release cadence |

### Market data
| Tool | What it gets you |
|---|---|
| `extract_finance` | Live stock data — price, market cap, P/E, 52w range. Up to 5 tickers. |
| `search_jobs` | Remote job listings from Remotive, RemoteOK, HN "Who is Hiring" — every listing dated |

### Composites — multiple sources, one call
| Tool | Sources | What it gets you |
|---|---|---|
| `extract_landscape` | 6 | YC + GitHub + HN + Reddit + Product Hunt + npm in parallel |
| `extract_idea_landscape` | 6 | HN + YC + GitHub + Jobs + npm + Product Hunt — full idea validation |
| `extract_gov_landscape` | 4 | Gov contracts + HN + GitHub + changelog |
| `extract_finance_landscape` | 5 | Finance + HN + Reddit + GitHub + changelog |
| `extract_company_landscape` | 5 | **The full picture on any company** — see below |

### Unique — not available in any other MCP server
| Tool | Source | What it gets you |
|---|---|---|
| `extract_changelog` | GitHub Releases API / npm / auto-discover | Update history from any repo, package, or website |
| `extract_govcontracts` | USASpending.gov | US federal contract awards — company, amount, agency, period |
| `extract_sec_filings` | SEC EDGAR | 8-K filings — legally mandated material event disclosures |
| `extract_gdelt` | GDELT Project | Global news intelligence — 100+ languages, every country, 15-min updates |
| `extract_gebiz` | data.gov.sg | Singapore Government procurement tenders — open dataset, no auth |

---

## extract_idea_landscape

Built for the moment before you start building. Six sources fired in parallel to answer: *should I build this?*

1. **Hacker News** — what are developers actively complaining about (pain signal)
2. **YC Companies** — who has already received funding in this space (funding signal)
3. **GitHub** — how crowded the open source landscape is (crowding signal)
4. **Job listings** — companies hiring around this problem = real budget = real market (market signal)
5. **npm / PyPI** — ecosystem adoption and release velocity (ecosystem signal)
6. **Product Hunt** — what just launched and how the market received it (launch signal)

```
Use extract_idea_landscape with idea "data freshness for AI agents"
```

---

## extract_company_landscape

The most complete single-call company analysis available in any MCP server. Five sources fired in parallel:

1. **SEC EDGAR** — what did they legally just disclose (8-K filings)
2. **USASpending.gov** — who is giving them government money
3. **GDELT** — what is global news saying right now
4. **Changelog** — are they actually shipping product
5. **Yahoo Finance** — what is the market pricing in

```
Use extract_company_landscape with company "Palantir" and ticker "PLTR"
```

Real output from March 2026:

> **Q4 2025:** Revenue $1.407B (+70% YoY). US commercial +137%. Rule of 40 score: **127%**.
> **Federal contracts:** $292.7M Army Maven Smart System · $252.5M CDAO · $145M ICE · $130M Air Force · more
> **SEC filing:** Q4 earnings 8-K filed Feb 3, 2026 — GAAP net income $609M, 43% margin
> **GDELT:** ICE/Medicaid data controversy, UK MoD security warning, NHS opposition — all timestamped
> **PLTR:** ~$154–157 · Market cap ~$370B · P/E 244x · 52w range $66 → $207

Bloomberg Terminal doesn't read commit history as a company health signal. FreshContext does.

---

## Quick Start

### Option A — Cloud (no install)

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

---

### Option B — Local (full Playwright)

**Requires:** Node.js 18+ ([nodejs.org](https://nodejs.org))

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

---

### Troubleshooting (Mac)

**"command not found: node"** — Use the full path:
```bash
which node  # copy this output, replace "node" in config
```

**Config file doesn't exist** — Create it:
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
SEC filings + federal contracts + global news + changelog + market data. The complete picture.

**Is anyone already building what you're building?**
```
Use extract_landscape with topic "cashflow prediction saas"
```
Returns who's funded, what's trending, what repos exist, what packages are moving — all timestamped.

**What's Singapore's government procuring right now?**
```
Use extract_gebiz with url "artificial intelligence"
```
Returns live tenders from the Ministry of Finance open dataset — agency, amount, closing date, all timestamped.

**Did that company just disclose something material?**
```
Use extract_sec_filings with url "Palantir Technologies"
```
8-K filings are legally mandated within 4 business days of any material event — CEO change, acquisition, breach, major contract.

**What is global news saying about a company right now?**
```
Use extract_gdelt with url "Palantir"
```
100+ languages, every country, updated every 15 minutes. Surfaces what Western sources miss.

**Which companies just won US government contracts in AI?**
```
Use extract_govcontracts with url "artificial intelligence"
```
Largest recent federal contract awards matching that keyword — company, amount, agency, award date.

**Is this dependency still actively maintained?**
```
Use extract_changelog with url "https://github.com/org/repo"
```
Returns the last 8 releases with exact dates. If the last release was 18 months ago, you'll know before you pin the version.

---

## How freshness works

Most AI tools retrieve data silently. No timestamp, no signal, no way for the agent to know how old it is.

FreshContext treats **retrieval time as first-class metadata**. Every adapter returns:

- `retrieved_at` — exact ISO timestamp of the fetch
- `content_date` — best estimate of when the content was originally published
- `freshness_confidence` — `high`, `medium`, or `low` based on signal quality
- `freshness_score` — numeric 0–100 with domain-specific decay rates (financial data at 5.0, academic papers at 0.3)
- `adapter` — which source the data came from

When confidence is `high`, the date came from a structured field (API, metadata). When it's `medium` or `low`, FreshContext tells you why.

---

## Security

- Input sanitization and domain allowlists on all adapters
- SSRF prevention (blocked private IP ranges)
- KV-backed global rate limiting: 60 req/min per IP across all edge nodes
- No credentials required — all public data sources

---

## Roadmap

- [x] 20 tools across intelligence, competitive research, market data, and composites
- [x] `extract_changelog` — update cadence from any repo, package, or website
- [x] `extract_govcontracts` — US federal contract intelligence via USASpending.gov
- [x] `extract_sec_filings` — SEC EDGAR 8-K material event filings
- [x] `extract_gdelt` — GDELT global news intelligence (100+ languages)
- [x] `extract_gebiz` — Singapore Government procurement via data.gov.sg
- [x] `extract_company_landscape` — 5-source company intelligence composite
- [x] `extract_idea_landscape` — 6-source idea validation composite
- [x] `freshness_score` numeric metric (0–100) with domain-specific decay rates
- [x] Cloudflare Workers deployment — global edge with KV caching and rate limiting
- [x] D1 database — 18 watched queries running on 6-hour cron with relevancy scoring
- [x] Listed on official MCP Registry
- [x] Listed on Apify Store
- [x] FreshContext Specification v1.1 published (MIT) — composite adapters, decay rate table, compatibility levels
- [x] GitHub Actions CI/CD — auto-publish to npm on every push
- [ ] GKG upgrade for `extract_gdelt` — tone scores, goldstein scale, event codes
- [ ] Dashboard — React frontend for the D1 intelligence pipeline
- [ ] Synthesis endpoint — `/briefing/now` AI-generated intelligence briefings
- [ ] `freshness_score` filtering on composite tools

---

## Contributing

PRs welcome. New adapters are the highest-value contribution — see `src/adapters/` for the pattern and `FRESHCONTEXT_SPEC.md` for the contract any adapter must fulfill.

If you're building something FreshContext-compatible, open an issue and we'll add you to the ecosystem list.

---

## License

MIT

---

*Built by Prince Gabriel — Grootfontein, Namibia 🇳🇦*
*"The work isn't gone. It's just waiting to be continued."*

---

**Also on:** [Apify Store](https://apify.com/prince_gabriel/freshcontext-mcp) · [MCP Registry](https://registry.modelcontextprotocol.io) · [npm](https://www.npmjs.com/package/freshcontext-mcp)
