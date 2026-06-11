# FreshContext Release Integrity Notes

This document describes release hardening practices for future FreshContext package and archive releases. It is a plan and checklist, not an implemented signing or SBOM system.

## Before Publishing or Sharing a Package

- Start from a clean working tree.
- Confirm the package version intentionally matches the release plan.
- Run `npm run build`.
- Run `npm test`.
- Run `npm run smoke:stdio`.
- Run `npm run example:ha-pri-v2`.
- Run `cd worker && npx tsc --noEmit`.
- Run `npm audit --omit=dev`.
- Run `npm audit`.
- Run `npm pack --dry-run --json`.
- Smoke-test the packed tarball in a temporary install:
  - Confirm `npm start` works from the installed package.
  - Confirm the `freshcontext-mcp` binary works from the installed package.
  - Confirm repo-only scripts print a source-checkout notice instead of failing when examples, tests, or scripts are intentionally excluded.
  - Confirm `dist/server.js` is present and `dist/apify.js` is absent from the MCP npm package.
  - Confirm fresh consumer `npm audit --omit=dev` is clean.
- Run a stale-claim scan across public docs and package-facing files.
- Run a secret scan before sharing archives, diligence folders, or package artifacts.
- Keep operational demo runbooks, buyer scripts, outreach plans, diligence checklists, and private commercial materials outside the public npm package.

## Package Exclusion Checks

Confirm release artifacts do not include:

- Local environment files.
- Tokens or local credential files.
- MCP registry local credential files.
- Cloudflare local state.
- Local database snapshots or SQL dumps.
- Private sale, buyer, target, outreach, or diligence documents.
- Private data-room folders.
- Operational demo runbooks intended for buyer calls or internal screen-share rehearsal.
- Local logs.
- Old package tarballs.

## Release Notes and Integrity Artifacts

- Current prepared release notes: [`RELEASE_NOTES.md`](./RELEASE_NOTES.md).

Future release hardening may include:

- GitHub release notes for tagged releases.
- Signed git tags, if signing is configured.
- `SHA256SUMS` files for release artifacts.
- SBOM generation for buyer or enterprise diligence.
- npm provenance and signature review.
- A documented token-rotation checklist for any maintainer or ownership transfer.

Do not publish from a dirty working tree. Do not publish from an environment that exposes secrets in logs or command output.
