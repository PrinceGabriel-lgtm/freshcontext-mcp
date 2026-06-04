# FreshContext Source Profiles

Status: early Core metadata

FreshContext is a context gateway for agents and humans before reasoning. It turns raw candidate context into freshness-ranked, explained, provenance-aware context.

The product is not the number of MCP tools. The product is the decision layer that answers:

```text
What context deserves to reach the model first?
```

## Core Boundary

Core should swallow the intelligence, not the MCP protocol.

FreshContext Core owns deterministic context evaluation:

- signal normalization
- timestamp and future-date guards
- freshness scoring
- failure honesty
- context utility as sidecar output
- rank and explanation primitives
- optional envelope output
- optional provenance material

MCP, REST, SDK, CLI, and future operator workflows are hosts over Core. They should not redefine freshness, failure, ranking, or provenance behavior unless they are explicitly documenting a compatibility boundary.

## Adapter Boundary

Adapters provide candidate context. They fetch, search, scrape, read, or receive source data, then turn that data into FreshContext-compatible signals.

The named MCP tools in this repository are reference adapters, source-profile examples, and proof surfaces. They are useful, but they are not the product identity.

They demonstrate that FreshContext can evaluate different information classes:

- software activity
- social pulse
- academic and research material
- financial and market signals
- jobs and opportunities
- government, regulatory, and procurement data
- competitive and company intelligence
- composite multi-source landscapes

## Source Profiles

Source Profiles describe how a class of information should age, fail, rank, and explain.

Different sources age differently. A stock quote may go stale within hours. A legal filing or academic paper may remain useful for months or years. Official documentation may be older than a blog post but still more authoritative.

Source Profiles sit above adapters and below hosts:

```text
adapter output
  -> source profile policy
  -> Core evaluation
  -> host response
```

As of Pass 8-J, Core exports built-in profile presets and a small metadata contract shaped like:

```ts
type SourceProfile = {
  profile_id: string;
  source_types: string[];
  purpose: string;
  default_decay_lambda: number;
  half_life_hours: number;
  authority_hint: "high" | "medium" | "low";
  date_policy: "strict" | "balanced" | "lenient";
  failure_policy: "exclude" | "downgrade" | "warn";
  recommended_surfaces: ("mcp" | "rest" | "sdk" | "cli" | "operator")[];
};
```

The existing Core `LAMBDA` table is the current decay-policy reference. Source Profiles make that policy understandable and product-facing without changing Core behavior.

Pass 8-J adds:

- `BUILT_IN_SOURCE_PROFILES`
- `getSourceProfile(profileId)`
- `listSourceProfiles()`
- public Source Profile types

It does not add `retrieve(...)`, Operator mode, adapter selection, local file search, crawling, Worker integration, MCP runtime changes, or REST handler changes.

## Adapter Registry Metadata

As of Pass 8-S, the 21 MCP tools are also represented as adapter metadata. The registry maps each current tool name to a future adapter identity, Source Profile, output mode, runtime kind, and migration risk.

This registry is metadata-only. It does not change MCP behavior, adapter implementation behavior, Worker behavior, REST behavior, Core evaluation behavior, or runtime transport. It exists to make future extraction deliberate instead of ad hoc.

The likely first extraction target remains `extract_arxiv`, because it is a low-risk official API style adapter mapped to `academic_research`.

## Profile Groups

### Official / Canonical Documentation

Strategic future profile.

Purpose: official product docs, API docs, standards, changelogs, specifications, legal references, and canonical source material.

Expected policy:

- slower decay than news or social content
- high authority hint
- strict source attribution
- missing dates should warn rather than pretend freshness
- recommended for agents, SDK, CLI, and research workflows

Current related proof surfaces:

- `extract_changelog`
- `package_trends`
- future official-docs adapter

### Code / Software Activity

Purpose: repository activity, release cadence, dependency health, and implementation evidence.

Current reference adapters:

- `extract_github`
- `search_repos`
- `extract_changelog`
- `package_trends`

Existing source types:

- `github`
- `reposearch`
- `changelog`
- `packagetrends`

Policy intent:

- repository metadata decays slowly
- release and changelog data decays moderately
- source authority is medium to high depending on whether the data is official
- failed API or blocked output should be downgraded or excluded

### Social / Launch / Community Pulse

Purpose: community awareness, social proof, launch momentum, and early-market signal.

Current reference adapters:

- `extract_hackernews`
- `extract_reddit`
- `extract_producthunt`

Existing source types:

- `hackernews`
- `reddit`
- `producthunt`

Policy intent:

- faster decay than canonical docs or academic material
- authority hint is medium or low unless corroborated
- recent social signal is useful, but weak content should not dominate verified sources
- failure-looking or empty output should be excluded or downgraded

### Academic / Research

Purpose: scholarly material, papers, research abstracts, and citation-oriented context.

Current reference adapters:

- `extract_scholar`
- `extract_arxiv`

Existing source types:

- `google_scholar`
- `arxiv`

Policy intent:

- slow decay
- medium to high authority hint
- old material can remain useful if canonical or heavily cited
- date confidence matters, but old does not automatically mean irrelevant

### Market / Financial Recency

Purpose: market prices, quotes, financial movement, and finance-specific situational awareness.

Current reference adapters:

- `extract_finance`
- `extract_finance_landscape`

Existing source types:

- `finance`
- `finance_landscape`

Policy intent:

- strict timestamp handling
- high recency sensitivity
- stale financial data should be clearly marked
- unknown dates should not look fresh

### Jobs / Opportunity Freshness

Purpose: job listings, openings, hiring signals, and opportunity windows.

Current reference adapters:

- `search_jobs`

Existing source type:

- `jobs`

Policy intent:

- moderate to fast decay
- deadline and posting recency matter
- missing dates should warn
- stale jobs should be ranked below current opportunities

### Government / Regulatory / Procurement

Purpose: public-sector contracts, official filings, tenders, regulatory disclosures, and global news intelligence.

Current reference adapters:

- `extract_govcontracts`
- `extract_sec_filings`
- `extract_gebiz`
- `extract_gdelt`
- `extract_gov_landscape`

Existing source types:

- `govcontracts`
- `sec_filings`
- `gebiz`
- `gdelt`
- `gov_landscape`

Policy intent:

- official records usually have high authority
- news and global monitoring signals decay faster
- filing and tender dates should be strict
- unknown dates should not be treated as fresh

### Company / Competitive Intelligence

Purpose: company research, product velocity, ecosystem activity, funding/procurement signals, and competitive context.

Current reference adapters:

- `extract_yc`
- `extract_company_landscape`

Existing source types:

- `yc`
- `company_landscape`

Policy intent:

- mixed-source profile
- should preserve per-source timestamps where possible
- should explain whether signal came from official records, market data, community pulse, or repository activity
- useful for agents and buyer workflows, but not a replacement for due diligence

### Composite Landscape / Validation

Purpose: multi-source validation and idea or market landscape checks.

Current reference adapters:

- `extract_landscape`
- `extract_idea_landscape`
- `extract_gov_landscape`
- `extract_finance_landscape`
- `extract_company_landscape`

Existing source types:

- `landscape`
- `idea_landscape`
- `gov_landscape`
- `finance_landscape`
- `company_landscape`

Policy intent:

- each section should retain source-specific timestamps
- composite freshness must not collapse all sections into one fake timestamp
- partial failures should be visible
- all-unavailable composites should not be cached or promoted as fresh

### Local / Custom Context

Strategic future profile.

Purpose: user-provided files, PDFs, notes, lecture material, source lists, internal docs, research folders, and custom retrieval results.

Expected policy:

- user consent is required
- source boundaries must be explicit
- local file metadata and extracted document dates should be treated cautiously
- official/canonical local material may decay slowly
- notes, drafts, or unknown-date content should warn rather than pretend freshness
- recommended for CLI, SDK, and future operator workflows

This profile is important for students, researchers, developers, and internal agent workflows. It is not implemented as local file search in this pass.

## Host Surfaces

### MCP

MCP remains a first-class host surface for agents and clients that speak MCP.

MCP owns:

- tool schemas
- reference adapter invocation
- MCP response shape
- client compatibility

MCP does not own the FreshContext product identity.

### REST

REST is a host around Core evaluation.

The local REST primitive currently supports:

- `GET /v1/health`
- `POST /v1/evaluate`
- `POST /v1/evaluate-batch`

REST should not become a crawler, cache, dashboard, billing system, or Worker replacement.

### SDK

Future SDKs should expose Core evaluation and later source-profile helpers.

The first SDK shape should prefer explicit inputs:

```ts
evaluateSignal(signal, options);
evaluateSignals(signals, options);
```

Higher-level retrieval should wait until Source Profiles are stable.

### CLI

Future CLI workflows should make FreshContext understandable to developers, students, and researchers.

Possible future commands:

```text
freshcontext evaluate sources.json
freshcontext check-sources bibliography.md
freshcontext rank-notes ./research-folder
```

These commands are not implemented in this pass.

## Future Operator Layer

The Operator is a future optional workflow over adapters and Core.

It may eventually:

- accept a task and query
- choose allowed source profiles
- call adapters or host-provided retrievers
- refresh stale sources
- evaluate candidates through Core
- return the best context bundle

Future concept:

```ts
freshcontext.retrieve({
  task: "agent research",
  query: "latest Cloudflare MCP auth changes",
  sources: ["official_docs", "github", "news"],
  policy: "balanced",
  max_context_items: 8
});
```

This is not implemented yet.

This pass does not add:

- retrieval orchestration
- crawling
- browsing
- local file search
- adapter selection
- Worker or MCP runtime changes
- production Ha-Pri enforcement
- utility-weighted ranking

## Product Framing

Preferred sentence:

```text
FreshContext is a context gateway for agents and researchers: it turns raw retrieval results into freshness-ranked, provenance-aware context.
```

Sharper agent-facing sentence:

```text
FreshContext decides what context deserves to reach the model.
```

Use named reference adapters as proof of breadth, not as the headline.

