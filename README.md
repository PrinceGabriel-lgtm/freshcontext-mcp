# freshcontext-mcp

I asked Claude to help me find a job. It gave me a list of openings. I applied to three of them. Two didn't exist anymore. One had been closed for two years.

Claude had no idea. It presented everything with the same confidence.

That's the problem freshcontext fixes.

[![npm version](https://img.shields.io/npm/v/freshcontext-mcp)](https://www.npmjs.com/package/freshcontext-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

---

## What it does

Every MCP server returns data. freshcontext returns data **plus when it was retrieved and how confident that date is** — wrapped in a FreshContext envelope:

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

Claude now knows the difference between something from this morning and something from two years ago. You do too.

---

## 11 tools. No API keys.

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
| `extract_finance` | Live stock data — price, market cap, P/E, 52w range |

### Composite
| Tool | What it gets you |
|---|---|
| `extract_landscape` | One call. YC + GitHub + HN + Reddit + Product Hunt + npm in parallel. Full timestamped picture. |

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

**Is anyone already building what you're building?**
```
Use extract_landscape with topic "cashflow prediction saas"
```
Returns who's funded, what's trending, what repos exist, what packages are moving — all timestamped.

**What's the community actually saying right now?**
```
Use extract_reddit on r/MachineLearning
Use extract_hackernews to search "mcp server 2026"
```

**Did that company actually ship recently?**
```
Use extract_github on https://github.com/some-org/some-repo
```
Check `Published` vs `Retrieved`. If the gap is 18 months, Claude will tell you.

---

## How freshness works

Most AI tools retrieve data silently. No timestamp, no signal, no way for the agent to know how old it is.

freshcontext treats **retrieval time as first-class metadata**. Every adapter returns:

- `retrieved_at` — exact ISO timestamp of the fetch
- `content_date` — best estimate of when the content was originally published
- `freshness_confidence` — `high`, `medium`, or `low` based on signal quality
- `adapter` — which source the data came from

When confidence is `high`, the date came from a structured field (API, metadata). When it's `medium` or `low`, freshcontext tells you why.

---

## Security

- Input sanitization and domain allowlists on all adapters
- SSRF prevention (blocked private IP ranges)
- KV-backed global rate limiting: 60 req/min per IP across all edge nodes
- No credentials required — all public data sources

---

## Roadmap

- [x] GitHub, HN, Scholar, YC, Reddit, Product Hunt, Finance, arXiv adapters
- [x] `extract_landscape` — 6-source composite tool
- [x] Cloudflare Workers deployment
- [x] KV-backed global rate limiting
- [x] Listed on official MCP Registry
- [ ] TTL-based caching layer
- [ ] `freshness_score` numeric metric
- [ ] Job search adapter (the tool that started all this)

---

## Contributing

PRs welcome. New adapters are the highest-value contribution — see `src/adapters/` for the pattern.

---

## License

MIT
