# FreshContext Dependency Diligence Notes

This document records dependency and license diligence notes from the Trust L4/L5 cleanup. It is not legal advice and does not replace professional review for external review, distribution, or formal diligence.

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
