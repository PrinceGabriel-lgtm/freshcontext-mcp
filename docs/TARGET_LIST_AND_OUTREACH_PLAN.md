# FreshContext Target List and Soft Market Testing Plan

## Purpose

This plan is for controlled market-signal testing, not a launch, mass outreach campaign, or sales blast. The goal is to learn whether serious technical people understand the FreshContext problem, category, proof chain, and fit inside real AI systems.

The outreach question is about technical fit, not purchase intent:

```text
Does this framing make sense?
Where would this fit in your stack?
What would make this credible enough to try?
```

## Positioning hypothesis

FreshContext is a context-integrity layer for AI agents: raw signals in, freshness-ranked context out.

It ranks and wraps retrieval/tool signals with source, timestamp, confidence, freshness, utility, status, and provenance metadata before they reach an LLM or agent. Today, the asset is an integrated MCP/Core IP package: Core-led architecture, MCP-backed proof.

## Proof chain to share

- Strategic overview: https://freshcontext-site.pages.dev/context-integrity
- Demo: https://freshcontext-site.pages.dev/context-integrity-demo
- Technical spec: https://freshcontext-site.pages.dev/spec
- GitHub proof: https://github.com/PrinceGabriel-lgtm/freshcontext-mcp
- npm package: https://www.npmjs.com/package/freshcontext-mcp
- Codex/FreshContext MCP proof: Codex can use FreshContext locally through MCP, discovered 21 tools, and returned FreshContext envelopes.

Share one link at a time unless the recipient asks for more. The demo is usually the best first link for technical readers.

## Target categories

### AI agent / MCP builders

People building agent runtimes, MCP servers, MCP clients, tool routers, model-context systems, or agent workflow frameworks.

### RAG and retrieval infrastructure people

People building vector search, retrieval orchestration, document pipelines, search ranking, knowledge bases, or retrieval evaluation tooling.

### Devtool / observability founders

People building developer tools, AI observability, prompt tracing, agent debugging, monitoring, evaluation, or reliability products.

### Compliance-sensitive AI workflow people

People working on AI in legal, finance, procurement, healthcare operations, enterprise support, hiring, or other workflows where stale or untraceable context creates risk.

### Technical reviewers / open-source maintainers

People who can quickly judge whether the framing is technically legible, whether the demo is clear, and where the project fits in the ecosystem.

### Venture/accelerator technical scouts

Optional category. Use only when the scout has clear technical interest in agent infrastructure, AI tooling, RAG, governance, or open-source commercialization.

### Platform ecosystem people

Optional category. People involved in MCP ecosystems, agent platforms, AI dev platforms, Cloudflare/edge ecosystems, package registries, or developer marketplaces.

## Target list structure

Use this table to build the real list. Do not invent personal relationships. Mark the contact path honestly as warm, warm-ish, cold, or unknown.

| Name / organization | Category | Why relevant | Warm/cold path | Artifact to share | Question to ask | Priority | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `[real target]` | Agent / MCP | Builds or evaluates agent tool context | `[warm/cold]` | Demo | Does freshness-ranked context belong in the agent layer or tool layer? | High | Not sent |
| `[real target]` | RAG / retrieval | Owns retrieval ranking or RAG quality | `[warm/cold]` | Strategic overview | Would this fit before generation, after retrieval, or inside ranking? | High | Not sent |
| `[real target]` | Devtool / observability | Works on debugging agent behavior | `[warm/cold]` | Demo | Is this closer to retrieval quality, observability, or evals? | Medium | Not sent |

## Outreach angles

| Category | What to emphasize | What not to emphasize | Best artifact to share | Best feedback question |
| --- | --- | --- | --- | --- |
| AI agent / MCP builders | Context quality before tool output reaches the model; MCP-backed proof; Codex discovered 21 tools locally | Do not frame it as just another MCP tool list | Demo | Would you want this as an MCP layer, a library, or built into the agent runtime? |
| RAG and retrieval infrastructure people | Freshness-aware ranking after retrieval and before generation; source/date confidence; failure honesty | Do not lead with acquisition language or adapter count | Strategic overview | Where should temporal context scoring sit in a RAG pipeline? |
| Devtool / observability founders | Explainability of why context ranked, failed, or was penalized; auditability of agent inputs | Do not make it sound like a dashboard product | Demo | Is this closer to AI observability, retrieval quality, or agent reliability? |
| Compliance-sensitive AI workflow people | Traceable source, published/retrieved timestamps, confidence, and provenance metadata | Do not overclaim legal compliance, security, or tamper protection | Strategic overview | What evidence would a workflow owner need before trusting retrieved context? |
| Technical reviewers / open-source maintainers | Clear category test, demo clarity, spec clarity, GitHub proof | Do not ask for a broad endorsement | Demo | After 90 seconds, what do you think FreshContext is? |
| Venture/accelerator technical scouts | Category potential: context integrity for agents and RAG; proof chain already exists | Do not pitch valuation, urgency, or funding need | Strategic overview | Does this read like a product category, a feature, or an acquisition asset? |
| Platform ecosystem people | Fit inside MCP/agent ecosystems; context envelope as compatibility primitive | Do not ask them to promote it | Technical spec | Would a context-integrity layer help developers trust platform tool outputs? |

## Soft outreach rules

- No mass DM.
- No pricing first.
- No "please buy" language.
- Ask for technical feedback.
- Send one clear link.
- Ask one clear question.
- Track response quality, not just response rate.
- Stop if messaging feels confusing.
- Do not argue with feedback.
- Do not send repo archives, credentials, account access, or non-public diligence materials before NDA.
- Use the demo first when the contact is technical and short on time.
- Use the strategic overview first when the contact thinks in platform or product categories.
- Use the spec only when the contact asks for deeper technical detail.

## Success signals

- They ask for the demo.
- They ask for API or SDK shape.
- They ask how it integrates with their stack.
- They repeat the problem back accurately.
- They compare it to observability, RAG, evaluation, or governance tooling.
- They ask whether Codex, Claude, Cursor, or other agent clients can consume it.
- They ask whether Core can be used without MCP.
- They ask whether stale and failed sources can be filtered automatically.
- They ask about source confidence, timestamp confidence, or provenance boundaries.
- They offer a specific category label that is sharper than the current language.

## Failure/confusion signals

- They think it is just an MCP tool list.
- They think it requires Claude only.
- They think it is a dashboard only.
- They ask what problem it solves after reading.
- They focus only on number of tools.
- They think freshness equals truth.
- They assume Ha-Pri v1 is hard security enforcement.
- They ask for pricing before understanding the problem.
- They ask whether it is just web scraping.
- They cannot explain what changes before context reaches the model.

## First 10 outreach slots

These are slots, not real contacts. Fill them with real targets after review.

| Slot | Target archetype | Category | Primary artifact | Question to ask | Priority | Status |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Agent framework builder | Agent / MCP | Demo | Would this fit as an agent runtime layer or a tool-output layer? | High | Empty |
| 2 | MCP server/client builder | Agent / MCP | Demo | Does MCP-backed proof make the category easier to understand or narrower? | High | Empty |
| 3 | Agent workflow founder | Agent / MCP | Strategic overview | Where would context-integrity checks belong in your workflow stack? | High | Empty |
| 4 | Vector/RAG infrastructure engineer | RAG / retrieval | Strategic overview | Should freshness ranking happen before or after semantic retrieval? | High | Empty |
| 5 | Retrieval evaluation builder | RAG / retrieval | Demo | Would stale/unknown-date context be useful as an eval dimension? | Medium | Empty |
| 6 | AI observability founder | Devtool / observability | Demo | Is this observability, retrieval quality, agent reliability, or something else? | High | Empty |
| 7 | Developer tool reviewer | Devtool / observability | Demo | After 90 seconds, is the problem and proof clear? | Medium | Empty |
| 8 | Regulated workflow technologist | Compliance-sensitive workflow | Strategic overview | What evidence would make retrieved context acceptable in a controlled workflow? | Medium | Empty |
| 9 | Open-source maintainer/reviewer | Technical reviewer | GitHub repo | Does the repo support the context-integrity claim, or does it still read like MCP only? | Medium | Empty |
| 10 | Platform ecosystem contact | Platform ecosystem | Technical spec | Would an envelope/spec layer help platform developers trust tool context? | Medium | Empty |

## Tracking format

Use a small tracker. Do not over-instrument the first batch.

| Date | Target | Category | Link sent | Question asked | Response quality | Key quote/paraphrase | Next step | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `[date]` | `[name/org]` | `[category]` | `[one link]` | `[one question]` | High / Medium / Low / None | `[short note]` | `[follow-up or stop]` | Draft |

Response quality guide:

- High: understands the problem, asks about integration, gives category language, or requests a deeper demo.
- Medium: understands part of the problem but needs clearer positioning.
- Low: focuses on adapter count, MCP only, or does not see the problem.
- None: no reply after one respectful follow-up.

## Message testing notes

Track which phrase lands:

- context-integrity infrastructure
- freshness-aware retrieval
- provenance-aware context layer
- agent context governance
- retrieval quality layer
- temporal intelligence for agent context

Retire wording that consistently causes confusion. Keep wording that recipients repeat back accurately.

## Next action

Fill 10 real targets, review wording, then send only 3 soft asks first.
