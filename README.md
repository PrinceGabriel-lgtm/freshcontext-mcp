# freshcontext-mcp

> Real-time web extraction MCP server with guaranteed freshness timestamps for AI agents.

## The Problem

LLMs hallucinate recency. They'll cite a 2022 job posting as "current" or recall outdated API docs as if they're live. This happens because they have no reliable signal for *when* data was retrieved vs. when it was published.

## The Fix

Every piece of data extracted by `freshcontext-mcp` is wrapped in a `FreshContext` envelope:

```json
{
  "content": "...",
  "source_url": "https://github.com/owner/repo",
  "content_date": "2024-11-03",
  "retrieved_at": "2026-03-02T10:14:00Z",
  "freshness_confidence": "high",
  "adapter": "github"
}
```

The AI agent always knows *when it's looking at*, not just *what*.

## Adapters

| Adapter | Tool Name | What it extracts |
|---|---|---|
| GitHub | `extract_github` | README, stars, forks, last commit, topics |
| Google Scholar | `extract_scholar` | Titles, authors, years, snippets |
| Hacker News | `extract_hackernews` | Top stories, scores, post timestamps |

## Setup

```bash
git clone https://github.com/YOUR_USERNAME/freshcontext-mcp
cd freshcontext-mcp
npm install
npx playwright install chromium
npm run build
```

## Test locally

```bash
npm run inspect
```

## Connect to Claude

Add to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "freshcontext": {
      "command": "node",
      "args": ["/absolute/path/to/freshcontext-mcp/dist/server.js"]
    }
  }
}
```

## Roadmap

- [ ] Twitter/X public feed adapter
- [ ] Dev.to / Hashnode adapter  
- [ ] Supabase changelog adapter
- [ ] Cloudflare Worker deployment
- [ ] Caching layer with TTL
