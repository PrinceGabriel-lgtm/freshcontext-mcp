# FreshContext — Usage Guide
> *13 tools. No API keys. Every result timestamped.*

---

## Quick Start

Add FreshContext to Claude Desktop (no install required):

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

Restart Claude. Done. All 13 tools are now available.

---

## The 13 Tools

| Tool | What it does | Input |
|---|---|---|
| `extract_github` | README, stars, forks, last commit | GitHub URL |
| `extract_hackernews` | Stories + scores with timestamps | HN URL or search query |
| `extract_scholar` | Research papers ranked by year | Google Scholar URL |
| `extract_arxiv` | arXiv papers via official API | Search query or arXiv URL |
| `extract_reddit` | Subreddit posts + community sentiment | Subreddit URL |
| `extract_yc` | YC company listings by keyword | Topic keyword |
| `extract_producthunt` | Recent launches by topic | Topic or PH URL |
| `search_repos` | GitHub repos ranked by stars + recency | Search query |
| `package_trends` | npm/PyPI metadata + download stats | Package name(s) |
| `extract_finance` | Live stock data — price, P/E, 52w range | Ticker symbol(s) |
| `extract_landscape` | 6 sources in one call | Topic keyword |
| `extract_changelog` | Update history from any product/repo | GitHub URL, npm name, or website URL |
| `extract_govcontracts` | US federal contract awards | Company name, keyword, or NAICS code |

---

## Command Reference

Copy and paste these directly into Claude.

---

### Competitive Research

```
Use extract_landscape with topic "AI data freshness"
```
*Full picture: who's funded, what's trending, what repos exist, what packages are moving.*

```
Use search_repos with query "mcp server typescript"
```
*GitHub repos ranked by stars. See who's already building in your space.*

```
Use extract_yc with query "developer infrastructure"
```
*Which YC companies are funded in your category.*

```
Use extract_producthunt with url "developer tools"
```
*What launched this week in your category.*

---

### Market Intelligence

```
Use extract_hackernews with url "https://hn.algolia.com/?q=model+context+protocol+2026"
```
*What the developer community is saying about a topic right now.*

```
Use extract_reddit with url "https://www.reddit.com/r/MachineLearning/"
```
*Subreddit sentiment — what problems people are complaining about or excited about.*

```
Use extract_finance with url "NVDA,MSFT,GOOGL"
```
*Live stock data for competitive set. Know the market before a pitch.*

```
Use extract_govcontracts with url "AI infrastructure"
```
*Which companies are winning federal AI contracts. High-signal GTM data.*

```
Use extract_govcontracts with url "Palantir"
```
*How much government business a specific company is doing — and when.*

---

### Job Market Intelligence

```
Use search_jobs with query "AI engineer" location "remote" max_age_days 7
```
*Fresh job listings only. Every result has a freshness badge — never apply to a closed role again.*

```
Use search_jobs with query "typescript developer" remote_only true
```
*Remote-only filtered results with publish dates.*

```
Use extract_govcontracts with url "541511"
```
*NAICS 541511 = Custom Computer Programming Services. See who's hiring via contract awards.*

---

### Developer Ecosystem Research

```
Use package_trends with url "mcp,wrangler,anthropic"
```
*npm download trends for multiple packages. See what's gaining traction.*

```
Use extract_changelog with url "https://github.com/anthropics/anthropic-sdk-python"
```
*Latest releases with dates. Know exactly when a dependency shipped a change.*

```
Use extract_changelog with url "freshcontext-mcp"
```
*npm package changelog — version history and release cadence.*

```
Use extract_changelog with url "https://linear.app"
```
*Auto-discovers the changelog page and extracts update history.*

```
Use search_repos with query "cloudflare workers MCP 2026"
```
*What's being built on a platform right now.*

---

### Academic & Research Intelligence

```
Use extract_arxiv with url "https://arxiv.org/search/?query=model+context+protocol&searchtype=all"
```
*Latest papers on a topic with submission dates.*

```
Use extract_scholar with url "https://scholar.google.com/scholar?q=AI+agent+grounding"
```
*Google Scholar results ranked by recency.*

---

### Full Research Workflows

#### Validate a startup idea
```
1. Use extract_landscape with topic "[your idea]"
2. Use extract_yc with query "[your idea]"
3. Use extract_govcontracts with url "[your idea keyword]"
4. Use extract_hackernews with url "https://hn.algolia.com/?q=[your+idea]"
```
*Tells you: who's funded, what's trending, is there government demand, what do developers think.*

#### Research a company before a meeting
```
1. Use extract_github with url "https://github.com/[company]"
2. Use extract_changelog with url "https://github.com/[company]/[main-repo]"
3. Use extract_govcontracts with url "[company name]"
4. Use extract_finance with url "[ticker]"
```
*Tells you: how active is their engineering team, what did they ship recently, do they have government contracts, what's the stock doing.*

#### Find your next job
```
1. Use search_jobs with query "[your role]" max_age_days 7
2. Use extract_govcontracts with url "[target company]"
3. Use extract_changelog with url "https://github.com/[target-company]/[repo]"
```
*Fresh listings only + proof the company is growing + proof they're actively shipping.*

#### Track a competitor
```
1. Use extract_changelog with url "https://[competitor].com"
2. Use extract_github with url "https://github.com/[competitor]/[repo]"
3. Use package_trends with url "[competitor-npm-package]"
4. Use extract_hackernews with url "https://hn.algolia.com/?q=[competitor+name]"
```
*When did they last ship? Is their repo active? Are downloads growing? What is the community saying?*

---

## Who This Is For

### Jobseekers
The tool FreshContext was built for. Stop applying to roles that closed months ago. Every job listing comes with a freshness badge — green means posted this week, red means posted 60+ days ago. Filter by `max_age_days` to only see roles posted recently.

**Key tools:** `search_jobs`, `extract_govcontracts`, `extract_changelog`

---

### Founders & Product Teams
Validate ideas, track competitors, monitor your ecosystem. `extract_landscape` gives you a full competitive picture in one call — YC funding, GitHub activity, HN sentiment, Product Hunt launches, npm traction, all timestamped.

**Key tools:** `extract_landscape`, `extract_yc`, `extract_changelog`, `extract_hackernews`

---

### GTM & Sales Teams
Government contracts are buying intent signals. A company that just won a $5M DoD contract is hiring, spending, and building. FreshContext is the only MCP server with access to USASpending.gov contract data.

**Key tools:** `extract_govcontracts`, `extract_landscape`, `extract_finance`

---

### Investors & Analysts
Track portfolio companies, find signals before they're obvious, monitor competitor funding. `extract_govcontracts` shows government contract pipeline. `extract_changelog` shows engineering velocity. `extract_finance` gives live market data.

**Key tools:** `extract_govcontracts`, `extract_landscape`, `extract_finance`, `extract_changelog`

---

### Researchers & Academics
Fresh papers from arXiv and Google Scholar, ranked by date. Never cite a paper without knowing exactly when it was published and retrieved.

**Key tools:** `extract_arxiv`, `extract_scholar`, `extract_hackernews`

---

### Developers & DevRel Teams
Monitor your dependencies, track ecosystem traction, see what's getting attention in the community. `extract_changelog` works on any GitHub repo, npm package, or website that has a changelog.

**Key tools:** `extract_changelog`, `package_trends`, `search_repos`, `extract_github`

---

## Understanding the FreshContext Envelope

Every result is wrapped like this:

```
[FRESHCONTEXT]
Source: https://github.com/owner/repo
Published: 2026-03-10
Retrieved: 2026-03-17T09:19:00Z
Confidence: high
---
... content ...
[/FRESHCONTEXT]
```

**Confidence levels:**
- `high` — date came from a structured API field. Reliable.
- `medium` — date inferred from page signals or URL patterns. Likely correct.
- `low` — no date signal found. Treat with caution.

The gap between `Published` and `Retrieved` is your staleness indicator. If a job was published 90 days ago and retrieved today, the role is likely filled. If a GitHub repo was last pushed 2 years ago, the project may be abandoned.

---

## Freshness Score (coming in v0.4.0)

A numeric score from 0–100 will be added to every result:

```
freshness_score = max(0, 100 - (days_since_retrieved × decay_rate))
```

Different data types decay at different rates — financial data goes stale faster than academic papers. You'll be able to filter results by `freshness_score > 70` directly in your prompts.

---

## The Standard

FreshContext implements the **FreshContext Specification v1.0** — an open standard for data freshness envelopes. See `FRESHCONTEXT_SPEC.md` for the full specification.

Any tool or agent that wraps its retrieved data in the FreshContext envelope is **FreshContext-compatible**.

---

*Built by Prince Gabriel — Grootfontein, Namibia 🇳🇦*
*"The work isn't gone. It's just waiting to be continued."*
