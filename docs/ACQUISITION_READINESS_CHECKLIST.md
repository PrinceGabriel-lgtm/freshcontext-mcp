# FreshContext Acquisition Readiness Checklist

This checklist prepares FreshContext for serious buyer, licensee, or technical evaluator access. It is intentionally focused on packaging, diligence, and transfer readiness, not new feature work.

## Technical readiness

- [ ] Confirm `freshcontext-mcp` builds from a clean checkout.
- [ ] Confirm the test suite passes or document known external-source instability.
- [ ] Confirm `npm run smoke:stdio` reports expected package/server version and tool count.
- [ ] Confirm `cd worker && npx tsc --noEmit` passes.
- [ ] Confirm public site and spec page are reachable.
- [ ] Confirm Worker health endpoint reports the expected version.
- [ ] Confirm the 21 tools are documented as reference adapters, not the core product.
- [ ] Confirm Core/MCP/Worker boundaries are documented.
- [ ] Decide whether Core will remain bundled with MCP for the transaction.
- [ ] Identify which MCP-specific assets transfer with the package.
- [ ] Confirm Ha-Pri v1 is described as provenance/audit stamp only.
- [ ] Confirm Ha-Pri v2 is design-only and not represented as implemented.
- [ ] Confirm docs describe the current asset as an integrated MCP/Core package, not a standalone Core SDK.
- [ ] Prepare a clean architecture diagram or one-page technical map.
- [ ] Prepare a short "how to run locally" evaluator guide.
- [ ] Verify no runtime behavior changed during packaging.

## Legal/IP readiness

- [ ] Define exact transaction scope: licence, exclusive vertical licence, assignment, or acquisition.
- [ ] Define included and excluded repos/assets.
- [ ] Confirm all relevant repos have intended licence files and package licence fields.
- [ ] Run third-party dependency licence review.
- [ ] Review source-specific API terms for adapters.
- [ ] Review contributor history and chain of title.
- [ ] Confirm no employer, contractor, or collaborator ownership issue.
- [ ] Confirm whether AI-assisted development needs disclosure in buyer materials.
- [ ] Decide whether public MIT spec remains separate from proprietary implementation/tuning rights.
- [ ] Decide whether a future Core extraction is included, excluded, or priced separately.
- [ ] Identify which general know-how and future independent implementations are carved out.
- [ ] Prepare IP assignment or licence schedule with asset list.
- [ ] Prepare brand/trade name transfer or licence language.

## Tax/accounting readiness

- [ ] Separate asset-sale, licence, services, and earnout payment categories.
- [ ] Confirm local tax treatment with a qualified advisor before quoting net proceeds.
- [ ] Prepare invoice/payment details only after NDA and buyer identity verification.
- [ ] Separate personal valuation notes from buyer-facing data room.
- [ ] Track development expenses, hosting costs, registry fees, and professional fees.
- [ ] Decide whether transition support is billed separately or included in purchase price.
- [ ] Prepare payment milestone structure for licence or acquisition deal.

## Security readiness

- [ ] Run secret scanning across included repos.
- [ ] Remove or rotate any exposed local API keys or tokens.
- [ ] Exclude `.env`, `.api-key.local.txt`, `.mcpregistry_*`, `.wrangler`, local caches, and account tokens from buyer packages.
- [ ] Prepare redacted config examples.
- [ ] Document required environment variables without revealing current production secrets.
- [ ] Review Cloudflare, npm, GitHub, MCP Registry, and Apify account access.
- [ ] Enable or verify 2FA on transfer-critical accounts.
- [ ] Prepare token rotation plan for post-transfer.
- [ ] Prepare buyer-safe logs with secrets redacted.

## Data room readiness

- [ ] Add `README.md`, `FRESHCONTEXT_SPEC.md`, `METHODOLOGY.md`, and buyer docs.
- [ ] Include source code snapshots for included repos.
- [ ] Include tests and validation output.
- [ ] Include architecture summary.
- [ ] Include public proof links and screenshots where useful.
- [ ] Include npm/MCP Registry/Apify presence evidence.
- [ ] Include Cloudflare deployment inventory, redacted.
- [ ] Include IP inventory and transfer checklist.
- [ ] Exclude negotiation notes, personal session notes, secrets, and unrelated local files.
- [ ] Version the data room so buyer access can be audited.

## Buyer demo readiness

- [ ] Prepare the "same query, conflicting/stale/fresh context" demo narrative.
- [ ] Show raw input signals before scoring.
- [ ] Show stale authoritative source.
- [ ] Show fresh weaker source.
- [ ] Show unknown-date source.
- [ ] Show failed/error source.
- [ ] Show how naive retrieval would pass all context forward.
- [ ] Show how FreshContext ranks, penalizes, explains, and wraps context.
- [ ] Show final FreshContext envelope passed to an agent.
- [ ] Keep demo focused on context integrity, not adapter count.
- [ ] Avoid live external calls in the primary buyer demo unless already rehearsed.

## Negotiation readiness

- [ ] Decide preferred path: licence, vertical exclusivity, acquisition, or acquisition plus transition support.
- [ ] Define minimum acceptable scope and non-negotiables.
- [ ] Decide whether Ops Pulse is included, separate, or carved out.
- [ ] Decide whether feed actors are included.
- [ ] Decide whether public site/accounts transfer or buyer receives source only.
- [ ] Prepare one-page summary for non-technical buyer executives.
- [ ] Prepare deeper technical package for evaluator/architect.
- [ ] Prepare NDA requirement before sharing source, secrets, account data, or non-public diligence.
- [ ] Prepare transition support offer with duration, availability, and deliverables.

## Red flags to fix before buyer access

- [ ] Secrets committed or present in shareable folders.
- [ ] Unclear ownership of repos or accounts.
- [ ] README or docs implying Ha-Pri v2 is implemented.
- [ ] README or docs implying FreshContext is only an MCP server.
- [ ] README or docs implying freshness equals truth.
- [ ] Broken build without explanation.
- [ ] Tests failing due to code regression.
- [ ] Public package version mismatch.
- [ ] Undocumented carve-outs such as Ops Pulse or feed actors.
- [ ] Personal financial, negotiation, or account details mixed into data room.

## What not to hand over before NDA

- [ ] Private repository write access.
- [ ] Production secrets, tokens, API keys, or auth headers.
- [ ] npm publish access.
- [ ] GitHub owner/admin access.
- [ ] Cloudflare account access.
- [ ] Apify account access.
- [ ] MCP Registry publisher tokens.
- [ ] D1 data exports with sensitive or account-specific information.
- [ ] Personal financial analysis or walk-away numbers.
- [ ] Unredacted session logs.
- [ ] Full transfer credentials.

## What can be shared publicly

- [ ] Public site link.
- [ ] Public spec page.
- [ ] Public GitHub README.
- [ ] npm package page.
- [ ] MCP Registry listing.
- [ ] Apify public listing, if published.
- [ ] High-level strategic brief without secrets or private negotiation notes.
- [ ] Public demo route.
- [ ] Public methodology/spec docs already licensed for public viewing.
- [ ] Non-confidential positioning: integrated MCP/Core IP package, Core-led architecture, MCP-backed proof, adapters are reference modules, Ops Pulse is separate diagnostics.
