# FreshContext IP Inventory

This document is a practical diligence inventory for FreshContext acquisition, licensing, or IP assignment preparation. It is not legal or tax advice. It is intended to help organize what exists, what may transfer, what may be licensed, and what must be reviewed before buyer access. Transaction structure, tax treatment, and IP assignment terms require professional legal/tax review.

## Assets included

Potential FreshContext transaction assets may include:

- integrated FreshContext MCP/Core primary repository
- Core scoring, envelope, freshness, utility, and provenance primitives
- MCP reference/interface implementation
- 21 read-only reference adapters/proof modules
- FreshContext Specification and methodology documents
- Decay-Adjusted Relevancy methodology
- context-conditioned utility primitive
- timestamped envelope format
- ranking and explanation primitives
- Ha-Pri v1 provenance/audit stamp implementation and documentation
- Ha-Pri v2 design document, as design only
- Cloudflare Worker implementation
- public site and spec page content
- demo assets
- test suite and smoke checks
- feed-oriented companion projects
- Apify actor/feed assets where owned
- Ops Pulse, if included in the deal
- brand/trade name assets and public distribution presence

Exact inclusion should be defined in the term sheet or asset purchase agreement.

## Repositories

Known local component folders:

| Asset | Local folder | Role |
|---|---|---|
| FreshContext MCP/Core | `C:\Users\Immanuel Gabriel\Downloads\freshcontext-mcp` | Main reference implementation, Core, MCP tools, Worker code, docs, tests |
| FreshContext site | `C:\Users\Immanuel Gabriel\Downloads\freshcontext-site` | Public landing/install/spec site deployed to Cloudflare Pages |
| FreshContext Worker | `C:\Users\Immanuel Gabriel\Downloads\freshcontext-worker` | Separate Cloud MCP Worker experiment/component |
| FreshContext profile | `C:\Users\Immanuel Gabriel\Downloads\freshcontext-profile` | User/profile configuration asset |
| Fresh HN Feed | `C:\Users\Immanuel Gabriel\Downloads\fresh-hn-feed` | Feed companion for Hacker News signals |
| Fresh Jobs Feed | `C:\Users\Immanuel Gabriel\Downloads\fresh-jobs-feed` | Feed companion for jobs signals |
| Fresh HN Feed Apify | `C:\Users\Immanuel Gabriel\Downloads\fresh-hn-feed-apify` | Apify actor wrapper for HN feed |
| Fresh Jobs Feed Apify | `C:\Users\Immanuel Gabriel\Downloads\fresh-jobs-feed-apify` | Apify actor wrapper for jobs feed |
| FreshContext Ops Pulse | `C:\Users\Immanuel Gabriel\Downloads\freshcontext-ops-pulse` | Separate diagnostics companion CLI |
| FreshContext hub folder | `C:\Users\Immanuel Gabriel\Downloads\freshcontext` | Local project index/session notes/shortcuts |

Public repository references visible in package metadata:

- `https://github.com/PrinceGabriel-lgtm/freshcontext-mcp`
- `https://github.com/PrinceGabriel-lgtm/freshcontext-ops-pulse`

Public repository URLs for the feed/site/worker components should be verified during diligence.

## Core/MCP separation status

FreshContext Core and FreshContext MCP are currently part of the same primary repository and transaction asset. Core is the emerging reusable scoring, envelope, freshness, utility, and provenance engine, while MCP is the main reference interface and distribution layer.

At the current stage, a transaction should treat FreshContext as an integrated MCP/Core IP package unless a later extraction phase separates Core into its own package, repository, SDK, or licence boundary.

This does not reduce the value of the asset. It clarifies the current transfer scope and avoids overstating architectural separation.

## Source code

Primary source code in `freshcontext-mcp`:

- `src/core/` - Core scoring, envelope, ranking, utility, guard, and shared types
- `src/adapters/` - reference adapters/proof modules
- `src/tools/` - MCP tool support
- `src/server.ts` - MCP server entry point
- `worker/src/` - Cloudflare Worker implementation
- `scripts/smoke-stdio.mjs` - local smoke validation
- `tests/` - TypeScript tests for Core, ranking, envelopes, Worker parity, Math Spine, and adapters

Buyer diligence should confirm which code is original, which code was generated or assisted, and which dependencies govern redistribution.

## Documentation

Primary documentation in `freshcontext-mcp`:

- `README.md` - public technical positioning and setup
- `FRESHCONTEXT_SPEC.md` - specification v1.2
- `METHODOLOGY.md` - Core, DAR, Store/Ledger, utility, and provenance methodology
- `USAGE.md` - usage guidance
- `ROADMAP.md` - roadmap and future direction
- `RISKS.md` - risk documentation
- `RESEARCH.md` - research notes
- `PASS_*_BRIEF.md` and `AUDIT_PASS*.md` - prior audit/phase records
- `docs/HA_PRI_V2_DESIGN.md` - future Ha-Pri v2 design, non-implemented
- `docs/STRATEGIC_BRIEF.md` - buyer-facing strategic brief
- `docs/IP_INVENTORY.md` - this inventory
- `docs/ACQUISITION_READINESS_CHECKLIST.md` - readiness checklist
- `docs/BUYER_DEMO_SCRIPT.md` - buyer demo script

Session save files are useful for reconstruction but should be reviewed before external sharing because they may include operational details, account references, or negotiation notes.

## Methodology/specs

FreshContext methodology assets include:

- FreshContext envelope format
- compatibility language for FreshContext-compatible, FreshContext-aware, and FreshContext-scored systems
- Decay-Adjusted Relevancy model
- source-specific decay classes
- timestamp confidence model
- failure honesty requirements
- context-conditioned utility formula
- semantic deduplication/fingerprinting method
- Store/Ledger design
- Ha-Pri v1 provenance stamp
- Ha-Pri v2 design path

Important boundary: the published spec is MIT-licensed. A buyer/licensor should distinguish between public open-standard materials and proprietary implementation, tuning, packaging, brand, service accounts, and future product rights.

## Domains/sites

Known public site:

- `https://freshcontext-site.pages.dev/`

Known public endpoints from current project notes:

- `https://freshcontext-mcp.gimmanuel73.workers.dev`
- `https://freshcontext-mcp.gimmanuel73.workers.dev/mcp`
- `https://freshcontext-mcp.gimmanuel73.workers.dev/demo`
- `https://freshcontext-mcp.gimmanuel73.workers.dev/health`
- `https://freshcontext-site.pages.dev/spec`
- Fresh HN Feed endpoint, to be verified in feed repo and Cloudflare account
- Fresh Jobs Feed endpoint, to be verified in feed repo and Cloudflare account

Checklist:

- [ ] Confirm all Cloudflare Pages and Worker project names.
- [ ] Confirm whether any custom domains exist.
- [ ] Confirm domain/account ownership.
- [ ] Confirm which sites can be transferred versus recreated.
- [ ] Export current Pages/Worker deployment metadata for data room.

## npm/package/registry presence

Known package presence:

- npm package: `freshcontext-mcp`
- current local package version: `0.3.18`
- MCP registry name in `package.json`: `io.github.PrinceGabriel-lgtm/freshcontext`
- Ops Pulse npm package metadata: `freshcontext-ops-pulse`, local version `0.1.1`

Checklist:

- [ ] Confirm npm account ownership and 2FA status.
- [ ] Confirm package collaborator list.
- [ ] Export npm package version history.
- [ ] Confirm MCP Registry listing and owner credentials.
- [ ] Decide whether registry/package ownership transfers, is licensed, or remains creator-owned.
- [ ] Do not share publish tokens before NDA and transfer terms.

## Cloudflare/Worker/deployment assets

Known Cloudflare-related assets:

- Worker code under `freshcontext-mcp/worker/`
- Worker config under `freshcontext-mcp/worker/wrangler.jsonc`
- separate `freshcontext-worker` project
- Cloudflare Pages static site in `freshcontext-site`
- feed Workers for HN and jobs
- D1-backed Store/Ledger methodology in the main Worker
- KV/rate-limit/cache references in Worker documentation
- `.wrangler` local folders, which should not be shared as IP materials

Checklist:

- [ ] Inventory Workers, Pages projects, D1 databases, KV namespaces, cron triggers, and environment variables in the Cloudflare dashboard.
- [ ] Confirm which bindings are production, preview, stale, or experimental.
- [ ] Export `wrangler` config files, but redact secrets.
- [ ] Document deployment commands without running them during diligence.
- [ ] Prepare transfer plan for Cloudflare account/project ownership.

## Feed actors

Known feed and actor assets:

- `fresh-hn-feed`
- `fresh-jobs-feed`
- `fresh-hn-feed-apify`
- `fresh-jobs-feed-apify`
- Apify-related files in the MCP repo, where applicable

Checklist:

- [ ] Confirm Apify account ownership.
- [ ] Confirm actor names, actor IDs, build history, pricing, and publication status.
- [ ] Confirm which actor code is original.
- [ ] Confirm whether Apify assets are included, licensed separately, or excluded.
- [ ] Export actor READMEs, schemas, Dockerfiles, and store listing copy.

## Ops Pulse relationship

Ops Pulse is a separate diagnostics companion for Cloudflare Workers, D1, cron, and observability workflows.

It is related to FreshContext operationally, but it is not FreshContext Core.

Transaction options:

- include Ops Pulse as a bundled support/diagnostics asset
- license Ops Pulse separately
- carve Ops Pulse out entirely
- grant buyer a short-term internal-use support licence during transition

The deal document should state this explicitly.

## Brand/trade name assets

Known names and marks to inventory:

- FreshContext
- freshcontext-mcp
- FreshContext Core
- FreshContext Specification
- FreshContext-compatible / aware / scored terminology
- Decay-Adjusted Relevancy / DAR
- Math Spine
- Ha-Pri
- Ops Pulse
- Fresh HN Feed
- Fresh Jobs Feed

Checklist:

- [ ] Search domain availability and existing registrations.
- [ ] Search trademark databases for conflicts in relevant jurisdictions.
- [ ] Confirm GitHub, npm, registry, Cloudflare, Apify, and social handles.
- [ ] Decide whether personal attribution remains in public docs after transfer.
- [ ] Prepare brand usage language for licence deals.

## Excluded assets / carve-outs

Potential carve-outs to define before buyer diligence:

- personal email accounts
- personal machine paths and local caches
- private API keys, tokens, and secrets
- unrelated projects in Downloads/OneDrive
- financial spreadsheets unless intentionally shared
- negotiation notes and personal valuation notes
- Claude/Codex session logs not needed for technical diligence
- Ops Pulse, unless explicitly included
- future ideas not implemented in the current repo
- Ha-Pri v2 implementation rights, if reserved or handled separately in transaction documents

Private buyer, outreach, and diligence materials are maintained outside the public repository.

## Third-party dependencies to review

Primary MCP package dependencies:

- `@modelcontextprotocol/sdk`
- `apify`
- `dotenv`
- `playwright`
- `zod`
- TypeScript/test/dev dependencies listed in `package.json`

Worker and companion projects have their own dependency trees.

Checklist:

- [ ] Run license scanner across all included repos.
- [ ] Review transitive licences for redistribution restrictions.
- [ ] Confirm Playwright/browser dependencies and install footprint.
- [ ] Confirm Apify SDK terms.
- [ ] Confirm MCP SDK licence and attribution requirements.
- [ ] Confirm any source-specific API terms for adapters.

## Open-source licence diligence checklist

- [ ] Confirm repository `LICENSE` files are present where needed.
- [ ] Confirm `package.json` licence fields match intended public licence.
- [ ] Confirm MIT-licensed spec boundary versus proprietary transaction assets.
- [ ] Review copied snippets, generated code, and third-party examples.
- [ ] Review README badges, logos, screenshots, and external brand references.
- [ ] Identify any GPL, AGPL, SSPL, BUSL, or other copyleft/restrictive dependencies.
- [ ] Prepare attribution notices if required.

## Contributor/chain-of-title checklist

- [ ] Identify all commit authors across included Git repos.
- [ ] Confirm whether all substantive code was authored by Immanuel Gabriel or properly assigned.
- [ ] Confirm whether any contractors, collaborators, or external contributors have rights.
- [ ] Confirm AI-assisted development policy and buyer disclosure preference.
- [ ] Confirm no employer-owned time, equipment, or confidential information created ownership risk.
- [ ] Prepare an IP assignment representation for legal review.

## Secrets/security checklist

- [ ] Remove or rotate any local `.env` values before sharing.
- [ ] Do not share `.api-key.local.txt`.
- [ ] Do not share registry, npm, GitHub, Cloudflare, Apify, or MCP publisher tokens.
- [ ] Review `.mcpregistry_*` files and exclude them from data room.
- [ ] Review `.wrangler` folders and exclude local state/cache.
- [ ] Run secret scanning across included repos.
- [ ] Rotate any token that was committed, zipped, emailed, or exposed in logs.
- [ ] Prepare redacted deployment instructions for technical evaluators.

## Transfer checklist

- [ ] Define transaction scope: licence, exclusive vertical licence, full IP assignment, or acquisition.
- [ ] Define included repos and excluded assets.
- [ ] Prepare clean archives or buyer-access branches.
- [ ] Prepare source, docs, tests, build instructions, and demo script.
- [ ] Prepare account transfer plan for GitHub, npm, MCP Registry, Cloudflare, Apify, and domains.
- [ ] Prepare secret rotation plan.
- [ ] Prepare support/transition statement of work.
- [ ] Prepare public announcement and attribution language.
- [ ] Confirm tax treatment with a qualified advisor before signing.
