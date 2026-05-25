# FreshContext First 10 Target Candidates

## Purpose

This document fills the first 10 target slots for controlled soft market testing. It is research and planning only. Do not send outreach from this document without reviewing each target and choosing the first three soft asks manually.

Selection criteria:

1. Technical enough to understand context integrity, agents, retrieval, observability, or governance.
2. Public evidence of work in agents, RAG, MCP, context, observability, evals, or AI reliability.
3. Reachable through a public channel such as GitHub, docs/community forum, public community page, company contact form, or public social profile.

No private emails, guessed contacts, or invented relationships are included.

## First 10 candidates

| # | Name / organization | Category | Why relevant | Public evidence URL | Best public channel | Suggested artifact to share | One question to ask | Priority | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Model Context Protocol project / Anthropic MCP ecosystem | Agent / MCP builder | MCP defines the protocol layer where tool and resource context reaches AI clients; FreshContext can test whether context integrity belongs inside or adjacent to MCP server output. | https://www.anthropic.com/research/model-context-protocol | https://github.com/modelcontextprotocol - verify exact repo/discussion before posting | Demo | Does freshness-ranked context belong as MCP server behavior, MCP client behavior, or a separate layer between tools and agents? | High | Draft |
| 2 | LangChain / LangGraph team and community | Agent / MCP builder | LangGraph is agent orchestration infrastructure, while LangChain/LangSmith touch tools, context, tracing, evaluation, and agent reliability. | https://docs.langchain.com/oss/python/langgraph/overview | https://forum.langchain.com/categories | Demo | Would FreshContext read as an agent-runtime context layer, a retrieval postprocessor, or an observability/eval signal? | High | Draft |
| 3 | Mastra | Agent / MCP builder | Mastra publicly positions agents around memory, tools, MCP, logging, tracing, evals, context, and guardrails. | https://mastra.ai/ai-agents | https://mastra.ai/docs/community/discord | Demo | In a tool-using agent stack, should stale/unknown/failed context be handled by the tool, the agent runtime, or a separate context-integrity layer? | High | Draft |
| 4 | LlamaIndex | RAG / retrieval | LlamaIndex is directly relevant to RAG pipelines, agents, document loading, querying, observability, evaluation, and MCP integrations. | https://developers.llamaindex.ai/python/framework/ | https://github.com/run-llama/llama_index/discussions | Strategic overview | Should temporal freshness and source confidence live before retrieval, after retrieval, or as a node/postprocessor step before generation? | High | Draft |
| 5 | Weaviate | RAG / retrieval | Weaviate is an open-source vector database/search platform with community channels around retrieval and vector search; FreshContext can test whether freshness scoring is useful beside semantic ranking. | https://docs.weaviate.io/weaviate | https://forum.weaviate.io/ | Strategic overview | Would freshness, published time, and failure status be useful as retrieval metadata, reranking signals, or downstream agent context? | High | Draft |
| 6 | Arize Phoenix | AI observability / devtool | Phoenix focuses on AI observability and evaluation, including traces, retrieval, tool use, experiments, and OpenTelemetry/OpenInference instrumentation. | https://arize.com/docs/phoenix | https://community.arize.com/ | Demo | Is FreshContext closer to retrieval quality, trace enrichment, evaluation metadata, or agent input governance? | High | Draft |
| 7 | Langfuse | AI observability / devtool | Langfuse is an open-source LLM observability platform that captures traces across LLM calls, retrieval steps, tool executions, inputs, outputs, timing, and metadata. | https://langfuse.com/docs/observability/overview | https://github.com/orgs/langfuse/discussions | Demo | Would freshness/confidence/provenance envelopes make sense as trace attributes, eval dimensions, or a pre-generation context gate? | High | Draft |
| 8 | Credo AI | Compliance / regulated AI workflow | Credo AI focuses on AI governance, policy, automated evidence, audit-ready workflows, and regulated AI adoption, including agentic AI governance. | https://www.credo.ai/product | https://www.credo.ai/product - use public company form/page; verify best route manually | Strategic overview | What evidence would a governance team need to trust retrieved context before an AI workflow acts on it? | Medium | Draft |
| 9 | OpenTelemetry GenAI Semantic Conventions | Open-source technical reviewer / maintainer | OpenTelemetry GenAI conventions standardize spans and attributes for model calls, retrievals, errors, sensitive content handling, and GenAI telemetry. | https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/ | https://github.com/open-telemetry/semantic-conventions-genai/issues | Technical spec | Does FreshContext's envelope map cleanly to GenAI telemetry, or should freshness/provenance be represented separately from traces? | Medium | Draft |
| 10 | Cloudflare Agents / Developer Platform | Platform ecosystem | Cloudflare Agents supports MCP clients/servers and agent deployment on the edge; FreshContext already has Worker/Pages proof surfaces and an MCP-backed implementation. | https://developers.cloudflare.com/agents/api-reference/mcp-client-api/ | https://cloudflare.community/ | Demo | Would a context-integrity layer fit naturally into Cloudflare Agents, MCP server hosting, or developer-platform examples? | Medium | Draft |

## Suggested first 3 soft asks

Start with one target from each language bucket:

1. Agent/MCP builder: Mastra or LangChain/LangGraph.
2. RAG/retrieval: LlamaIndex or Weaviate.
3. Observability/devtool: Arize Phoenix or Langfuse.

Do not send all 10. Send only 3 soft asks first and compare which category repeats the problem back most accurately.

## Category coverage

| Category | Count | Targets |
| --- | --- | --- |
| Agent / MCP builders | 3 | Model Context Protocol project / Anthropic MCP ecosystem; LangChain / LangGraph; Mastra |
| RAG / retrieval | 2 | LlamaIndex; Weaviate |
| AI observability / devtool | 2 | Arize Phoenix; Langfuse |
| Compliance / regulated AI workflow | 1 | Credo AI |
| Open-source technical reviewer / maintainer | 1 | OpenTelemetry GenAI Semantic Conventions |
| Platform ecosystem | 1 | Cloudflare Agents / Developer Platform |

## Outreach guardrails

- Send one link, not the whole bundle.
- Ask one technical-fit question.
- Do not lead with pricing, acquisition, or transaction language.
- Do not claim Core is already a standalone SDK.
- Do not post in issue trackers unless the question clearly belongs there.
- Prefer community/discussion channels over support queues when asking for feedback.
- Mark targets "verify manually" before sending if the public channel may not be intended for unsolicited feedback.
- Do not include private emails, guessed emails, phone numbers, or scraped personal contact data.

## Lightweight tracker

| Date | Target | Category | Link sent | Question asked | Response quality | Key quote/paraphrase | Next step | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `[date]` | `[target]` | `[category]` | `[one link]` | `[one question]` | High / Medium / Low / None | `[short note]` | `[follow-up or stop]` | Draft |

## Manual verification before outreach

- Confirm the target still matches the category.
- Confirm the public channel is appropriate for feedback, not just support.
- Confirm the chosen artifact is the best first link.
- Rewrite the question in the recipient's language.
- Stop after 3 sends and review signal quality before continuing.
