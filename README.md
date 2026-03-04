# freshcontext-mcp

> Timestamped web intelligence for AI agents. Every result is wrapped in a **FreshContext envelope** — so your agent always knows *when* it's looking at data, not just *what*.

[![npm version](https://img.shields.io/npm/v/freshcontext-mcp)](https://www.npmjs.com/package/freshcontext-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## The Problem

LLMs hallucinate recency. They'll cite a 2022 job posting as "current", recall outdated API docs as if they're live, or tell you a project is active when it hasn't been touched in two years. This happens because they have no reliable signal for *when* data was retrieved vs. when it was published.

Existing MCP servers return raw content. No timestamp. No confidence signal. No way for the agent to know if it's looking at something from this morning or three years ago.

## The Fix: FreshContext Envelope

Every piece of data extracted by `freshcontext-mcp` is wrapped in a structured envelope:

```
[FRESHCONTEXT]
Source: https://github.com/owner/repo
Published: 2024-11-03
Retrieved: 2026-03-04T10:14:00Z
Confidence: high
---
... content ...
[/FRESHCONTEXT]
```

The AI agent always knows **when it's looking at data**, not just what the data says.

---

## Tools

### 🔬 Intelligence Tools

| Tool | Description |
|---|---|
| `extract_github` | README, stars, forks, language, topics, last commit from any GitHub repo |
| `extract_hackernews` | Top stories or search results from HN with scores and timestamps |
| `extract_scholar` | Research paper titles, authors, years, and snippets from Google Scholar |

### 🚀 Competitive Intelligence Tools

| Tool | Description |
|---|---|
| `extract_yc` | Scrape YC company listings by keyword — find who's funded in your space |
| `search_repos` | Search GitHub for similar/competing repos, ranked by stars with activity signals |
| `package_trends` | npm and PyPI package metadata — version history, release cadence, last updated |

### 🗺️ Composite Tool

| Tool | Description |
|---|---|
| `extract_landscape` | **One call. Full picture.** Queries YC startups + GitHub repos + HN sentiment + package ecosystem simultaneously. Returns a unified landscape report. |

---

## Quick Start

### Option A — Cloud (no install, works immediately)

No Node, no Playwright, nothing to install. Just add this to your Claude Desktop config and restart.

**Mac:** open `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** open `%APPDATA%\Claude\claude_desktop_config.json`

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

Restart Claude Desktop. The freshcontext tools will appear in your session.

> **Note:** If `claude_desktop_config.json` doesn't exist yet, create it with the content above.

---

### Option B — Local (full Playwright, faster for heavy use)

**Prerequisites:** Node.js 18+ ([nodejs.org](https://nodejs.org))

```bash
git clone https://github.com/PrinceGabriel-lgtm/freshcontext-mcp
cd freshcontext-mcp
npm install
npx playwright install chromium
npm run build
```

Then add to your Claude Desktop config:

**Mac** (`~/Library/Application Support/Claude/claude_desktop_config.json`):
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

**Windows** (`%APPDATA%\Claude\claude_desktop_config.json`):
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

Restart Claude Desktop.

---

### Troubleshooting (Mac)

**"command not found: node"** — Node isn't on your PATH inside Claude Desktop's environment. Use the full path:
```bash
which node   # copy this output
```
Then replace `"command": "node"` with `"command": "/usr/local/bin/node"` (or whatever `which node` returned).

**"npx: command not found"** — Same issue. Run `which npx` and use the full path for Option A:
```json
"command": "/usr/local/bin/npx"
```

**Config file doesn't exist** — Create it. On Mac:
```bash
mkdir -p ~/Library/Application\ Support/Claude
touch ~/Library/Application\ Support/Claude/claude_desktop_config.json
```
Then paste the config JSON above into it.

---

## Usage Examples

### Check if anyone is already building what you're building

```
Use extract_landscape with topic "cashflow prediction mcp"
```

Returns a unified report: who's funded (YC), what's trending (HN), what repos exist (GitHub), what packages are active (npm/PyPI). All timestamped.

### Analyse a specific repo

```
Use extract_github on https://github.com/anthropics/anthropic-sdk-python
```

### Find research papers on a topic

```
Use extract_scholar on https://scholar.google.com/scholar?q=llm+context+freshness
```

### Check package ecosystem health

```
Use package_trends with packages "npm:@modelcontextprotocol/sdk,pypi:langchain"
```

---

## Why FreshContext?

Most AI agents retrieve data but don't timestamp it. This creates a silent failure mode: the agent presents stale information with the same confidence as fresh information. The user has no way to know the difference.

FreshContext treats **retrieval time as first-class metadata**. Every adapter returns:

- `retrieved_at` — exact ISO timestamp of when the data was fetched
- `content_date` — best estimate of when the content was originally published
- `freshness_confidence` — `high`, `medium`, or `low` based on signal quality
- `adapter` — which source the data came from

This makes freshness **verifiable**, not assumed.

---

## Deployment

### Local (Playwright-based)
Uses headless Chromium via Playwright. Full browser rendering for JavaScript-heavy sites.

### Cloud (Cloudflare Workers)
The `worker/` directory contains a Cloudflare Workers deployment. No Playwright dependency — runs at the edge globally.

```bash
cd worker
npm install
npx wrangler secret put API_KEY
npx wrangler deploy
```

---

## Project Structure

```
freshcontext-mcp/
├── src/
│   ├── server.ts              # MCP server, all tool registrations
│   ├── types.ts               # FreshContext interfaces
│   ├── security.ts            # Input validation, domain allowlists
│   ├── adapters/
│   │   ├── github.ts
│   │   ├── hackernews.ts
│   │   ├── scholar.ts
│   │   ├── yc.ts
│   │   ├── repoSearch.ts
│   │   └── packageTrends.ts
│   └── tools/
│       └── freshnessStamp.ts
└── worker/                    # Cloudflare Workers deployment
    └── src/worker.ts
```

---

## Roadmap

- [x] GitHub adapter
- [x] Hacker News adapter
- [x] Google Scholar adapter
- [x] YC startup scraper
- [x] GitHub repo search
- [x] npm/PyPI package trends
- [x] `extract_landscape` composite tool
- [x] Cloudflare Workers deployment
- [x] Worker auth + rate limiting + domain allowlists
- [ ] Product Hunt launches adapter
- [ ] Finance/market data adapter
- [ ] TTL-based caching layer
- [ ] `freshness_score` numeric metric

---

## Contributing

PRs welcome. New adapters are the highest-value contribution — see `src/adapters/` for the pattern. Each adapter returns `{ raw, content_date, freshness_confidence }`.

---

## License

MIT
