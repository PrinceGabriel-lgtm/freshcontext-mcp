# FreshContext Dependency Diligence Notes

This document records dependency and license diligence notes from the Trust L4/L5 cleanup. It is not legal advice and does not replace professional review for external review, distribution, or formal diligence.

## Dependency Risk Snapshot — 2026-09-22

A read-only dependency-risk triage of both trees at root `aed32ae` (`freshcontext-mcp@0.5.2`,
`freshcontext-mcp-worker@0.4.0`). No remediation was attempted; see "Outcome" below.

**Finding.** No currently identified advisory package was found to be reachable in the
deployed Worker bundle or shipped npm runtime as of 2026-09-22.

**Production posture is unchanged from the 2026-09-10 and 2026-09-13 records.**

| Tree | `npm audit --omit=dev` | `npm audit` (incl. dev) |
| --- | --- | --- |
| Root (`freshcontext-mcp`) | 0 | 7 — 3 high, 4 moderate |
| Worker (`worker/`) | 3 high (known, accepted) | 13 — 10 high, 3 moderate |

The root tree carries 535 dependencies (99 production, 436 dev). The higher `npm audit`
counts are dev-surface only and do not represent a change in shipped exposure. Note that
`worker/` is not covered by the root audit: root `workspaces` is `packages/*`, so the
Worker tree must be audited separately or its advisories go unseen.

**Classification method.** Each advisory was traced to its dependency-chain root with
`npm ls <pkg> --all`, then classified by whether that root is a runtime or development
dependency, and finally checked against the artifact that actually ships — the published
tarball for the root package, and the built bundle for the Worker. Severity counts alone
were not treated as evidence of exposure.

**Root tree.** All 7 advisories resolve to exactly two devDependencies, `apify@3.7.0` and
`jest@29.7.0`. The four runtime dependencies — `@modelcontextprotocol/sdk`, `dotenv`,
`playwright`, `zod` — were not flagged. Consumers install runtime dependencies only.
Confirmed against the artifact with `npm pack --dry-run`: 106 files, 482 KB, no
`node_modules`, and no Apify entrypoint (excluded by the `!dist/apify.js` files rule).

**Worker tree.** 12 of 13 advisories resolve to `wrangler`, `vitest` or
`@cloudflare/vitest-pool-workers` — local development and test tooling, not deployed. The
`undici` advisories reach the tree only through miniflare's local dev HTTP stack.

**Worker bundle inspection.** The one chain rooted in a runtime dependency remains
`@cloudflare/puppeteer -> @puppeteer/browsers -> extract-zip`, already recorded under
"Accepted, Unfixable, Not In The Artifact". This snapshot re-verified that acceptance
rather than restating it: `wrangler deploy --dry-run --outdir` produced `worker-e2.js`
(~1.8 MB, from `src/worker-e2.ts`). `@cloudflare/puppeteer` is present in the bundle;
`extract-zip`, `@puppeteer/browsers`, `undici`, `sharp`, `miniflare`, `postcss` and
`devalue` are all absent. The browser-download path that `extract-zip` serves does not
ship, consistent with the Worker obtaining its browser from the `BROWSER` binding.
`@cloudflare/puppeteer` carries no advisory of its own; it is flagged solely via that
dependency.

CI enforces this independently of this record: the `verify` job builds the bundle and
greps every emitted `.js`, globbing rather than naming a file so it covers either
entrypoint (`src/worker.ts` -> `worker.js`, `src/worker-e2.ts` -> `worker-e2.js`), and
fails the build if `extract-zip`, `@puppeteer/browsers` or `yauzl` appears. Sourcemaps
are excluded deliberately, since they embed original source text.

**Two reported findings did not survive verification.** Recorded so they are not
re-investigated: (1) `nanoid` appears to match in the bundle, but every occurrence is
zod's `.nanoid()` string-format validator regex — the package itself is not bundled, and
its generator markers are absent. (2) The `wrangler` high severity is not the
`wrangler pages deploy` OS command injection; that advisory covers `>=4.0.0 <4.59.1` and
the installed version is 4.99.0, past the range. Wrangler is flagged only transitively
through miniflare.

**Remediation cost, if later justified.** In-range for `js-yaml`, `browserslist`,
`adm-zip`, `baseline-browser-mapping`, `nanoid`, `postcss`, `devalue`. For the `apify` and
`@cloudflare/puppeteer` chains, npm's only proposal is a version *downgrade*
(`apify@2.3.2`, `@cloudflare/puppeteer@0.0.11`), which is not a remediation.
`vitest@4` and `@cloudflare/vitest-pool-workers@0.22` are genuine majors.

**Outcome.** No remediation was judged justified at this time, on the basis that no
advisory package was demonstrated to reach a shipped artifact. **No dependency,
lockfile, `package.json` or source change was made.** `npm audit fix` was not run.

**Tooling examined.** Node v25.6.1, npm 11.9.0, wrangler 4.99.0, `@cloudflare/puppeteer`
1.1.0, on Windows 11.

**Scope limit.** This assessment reflects the dependency graph and published advisories
available on 2026-09-22. Re-run dependency diligence before a release, customer security
review, or transaction diligence process. As noted under the `hono` entry below, `npm
audit` queries a live advisory database, so a result is a statement about a moment rather
than about a tree; the root tree moved from 0 to 7 reported advisories between 2026-09-10
and 2026-09-22 with no change to the lockfile.

## Transfer Inventory — 2026-09-13

`NOTICE.md` says to rerun dependency and licence inventory before any commercial
transfer or packaged diligence review. This is that rerun.

**Licence inventory, production dependencies only:**

| Tree | Licences found |
| --- | --- |
| Root (`freshcontext-mcp`) | MIT 83, ISC 7, BSD-2-Clause 2, BSD-3-Clause 2, Apache-2.0 2 |
| Worker (`worker/`) | MIT 132, ISC 13, Apache-2.0 11, BSD-2-Clause 6, BSD-3-Clause 5, 0BSD 1 |

**No copyleft anywhere.** No GPL, AGPL, LGPL, SSPL or CPAL in either production
tree. Checked by running the inventory against an explicit permissive allowlist,
which passes. Copyleft contamination is the usual licence blocker in a software
transfer; there is none here to clear.

**One finding, fixed in the same change.** The inventory reported
`freshcontext-mcp-worker@0.4.0` as UNLICENSED. That was this repository's own
`worker/package.json`, which carried no `license` field. Every other statement of
record — the root `LICENSE`, the root package manifest, `NOTICE.md` — says MIT,
while the component actually deployed to production declared nothing. `private: true`
governs npm publication, not the licence grant, so the two are not substitutes. The
field is now `"license": "MIT"`, and the licence story is consistent across the root
package, the worker, the LICENSE file and the notice.

**Audit, production dependencies:** root reports 0 vulnerabilities. The worker
reports the same 3 high advisories recorded below — `extract-zip` reached through
`@cloudflare/puppeteer`, still with no fixed version upstream and still absent from
the deployed bundle.

This is an inventory, not a legal opinion. A buyer should rerun it against the tree
they actually receive and have counsel review third-party attribution obligations.

## Current Audit Status

Root package, as of 2026-09-10:

- `npm audit --omit=dev`: clean (0 vulnerabilities). Enforced by CI as a blocking gate.
- `npm audit`: clean.

Worker (`worker/`), as of 2026-09-10:

- `npm audit --omit=dev`: 3 high, all `extract-zip` under `@cloudflare/puppeteer`. No
  fixed version exists upstream and the code is absent from the deployed bundle — see
  "Accepted, Unfixable, Not In The Artifact" below. Reported by CI, not gated.
- `npm audit`: additionally reports `undici` advisories reachable only through
  `@cloudflare/vitest-pool-workers`, a devDependency of the test harness. Not shipped.

Historical (Pass 8-AB): both root audits clean.
- The published MCP npm package excludes the Apify Actor entrypoint and does not install Apify/Crawlee in normal consumer installs.
- The previous moderate `qs` and `ws` advisories were resolved with narrow transitive overrides in the source checkout.
- No package version change was made.

## Resolved Advisories

`hono`

- Previous severity: moderate (three advisories affecting Hono through 4.13.4:
  GHSA-gqvv-2mrq-wpjv, GHSA-g6gw-c38x-mqfc, GHSA-crvj-82cr-hjcx).
- Path: `@modelcontextprotocol/sdk -> hono`, and `@hono/node-server -> hono` (peer).
- Resolution: raised the npm `overrides` floor from `^4.12.25` to `^4.13.5`, the first
  fixed release, and refreshed the lockfile. The root lockfile had resolved `4.13.1`;
  the floor was low enough for npm to resolve back below the fix, so raising the floor
  rather than pinning a single version is what actually holds.
- Note on how this surfaced: `main` audited clean on 2026-09-03 and failed on
  2026-09-10 with no dependency change in between. `npm audit` queries the live
  advisory database, so a green audit is a statement about a moment, not about a tree.
  This is why the audit now runs as its own CI job (see below).

`qs`

- Previous severity: moderate.
- Path: `@modelcontextprotocol/sdk -> express/body-parser -> qs`.
- Resolution: pinned through npm `overrides` to `qs@6.15.2`.

`ws`

- Previous severity: moderate.
- Historical source-checkout path: `apify -> ws`.
- Resolution: pinned through npm `overrides` to `ws@8.20.1` for source-checkout Apify Actor workflows.

`file-type`

- Previous severity: moderate in fresh consumer installs.
- Historical consumer path: `apify -> @crawlee/utils -> file-type`.
- Resolution: Apify/Crawlee were removed from the normal published MCP package dependency surface. Apify remains a source-checkout / separate-actor concern.

## Accepted, Unfixable, Not In The Artifact

`extract-zip` (via `@cloudflare/puppeteer -> @puppeteer/browsers -> extract-zip`)

- Severity: high — GHSA-jmr9-qjv8-65gv, GHSA-7pqw-9j4j-h8q3 (symlink path traversal /
  arbitrary file write through crafted archive entries).
- Advisory range is `*`, and `extract-zip` has never published past `2.0.1`. There is
  no fixed version to raise a floor to. The only remediation npm offers is downgrading
  `@cloudflare/puppeteer` to `0.0.11`, a breaking change.
- **Not present in the deployed artifact.** `@puppeteer/browsers` exists to download
  and unpack browser binaries; the Worker gets its browser from the `BROWSER`
  (Browser Rendering) binding and never takes that path. Verified against the real
  bundle: `wrangler deploy --dry-run --outdir` produces a ~1.8 MB `worker.js`
  containing zero occurrences of `extract-zip`, `@puppeteer/browsers` or `yauzl`.
- Because that is a claim about the artifact, CI now **forces it to stay true**: the
  `verify` job greps the built bundle and fails if any of those names appear. If a
  future `@cloudflare/puppeteer` release drags the download path into the bundle, the
  build breaks rather than the exposure landing silently.
- The Worker's `npm audit --omit=dev` therefore runs as an **advisory report** in the
  `audit` job, not a blocking gate. A gate that can only be satisfied by downgrading a
  dependency whose vulnerable code never ships is a gate that trains people to ignore
  CI. The root audit stays blocking: the root tree is what becomes the published npm
  tarball, which is a genuine public artifact.
- Recheck on every `@cloudflare/puppeteer` bump.

## License Inventory Notes

The Trust L4 license inventory was broadly permissive, including MIT, Apache-2.0, BSD variants, ISC, 0BSD, BlueOak-1.0.0, and similar permissive variants.

No GPL, AGPL, LGPL, MPL, EPL, CDDL, or similar copyleft licenses were reported in the Trust L4 scan.

`map-stream@0.1.0`

- Scanner result: `UNKNOWN`.
- Path observed during L4: transitive through source-checkout `apify` / Crawlee-related dependencies.
- Diligence note: package metadata appears incomplete, but the installed package includes an MIT-style license file.
- Action: keep as a source-checkout / actor-packaging diligence note and recheck before external diligence or Apify Actor distribution.

`caniuse-lite`

- Scanner result: `CC-BY-4.0`.
- Diligence note: preserve and review attribution requirements before external diligence, bundled distribution, or a formal review package.

## Before External Diligence or Distribution

- Rerun `npm audit --omit=dev`.
- Rerun `npm audit`.
- Rerun dependency license inventory.
- Review scanner-unknown packages.
- Review `caniuse-lite` attribution requirements.
- Generate an SBOM if requested by an evaluator, reviewer, or downstream distributor.
- Review dependency and license posture with qualified counsel when external distribution or formal diligence requires it.

Do not treat this document as a legal conclusion.
