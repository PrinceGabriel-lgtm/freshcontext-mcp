# FreshContext Dependency Diligence Notes

This document records dependency and license diligence notes from the Trust L4/L5 cleanup. It is not legal advice and does not replace professional review for external review, distribution, or formal diligence.

## Current Audit Status

As of Trust L5:

- `npm audit --omit=dev`: clean.
- `npm audit`: clean.
- The previous moderate `qs` and `ws` advisories were resolved with narrow transitive overrides.
- No direct dependency version changes were required.
- No package version change was made.

## Resolved Advisories

`qs`

- Previous severity: moderate.
- Path: `@modelcontextprotocol/sdk -> express/body-parser -> qs`.
- Resolution: pinned through npm `overrides` to `qs@6.15.2`.

`ws`

- Previous severity: moderate.
- Path: `apify -> ws`.
- Resolution: pinned through npm `overrides` to `ws@8.20.1`.

## License Inventory Notes

The Trust L4 license inventory was broadly permissive, including MIT, Apache-2.0, BSD variants, ISC, 0BSD, BlueOak-1.0.0, and similar permissive variants.

No GPL, AGPL, LGPL, MPL, EPL, CDDL, or similar copyleft licenses were reported in the Trust L4 scan.

`map-stream@0.1.0`

- Scanner result: `UNKNOWN`.
- Path observed during L4: transitive through `apify` / Crawlee-related dependencies.
- Diligence note: package metadata appears incomplete, but the installed package includes an MIT-style license file.
- Action: keep as a diligence note and recheck before external diligence or distribution.

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
