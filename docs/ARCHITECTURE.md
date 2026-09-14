# Architecture

This describes what FreshContext is today, at the commit you are reading. It replaces
`docs/CORE_MCP_BOUNDARY.md`, which described a migration plan rather than the system.
Where something is planned rather than built, it says so.

## Layers

```
                      node:crypto   ← the only external edge in Core
                           │
   ┌───────────────────────▼─────────────────────────────┐
   │  packages/core/  — @freshcontext/core               │
   │  the protocol-independent evaluation engine         │
   │  16 modules · 0 npm dependencies · 1 Node builtin   │
   │                                                     │
   │  src/index.ts  full surface                         │
   │  src/edge.ts   crypto-free subset for edge runtimes │
   │                                                     │
   │  built into dist/core/ by the root build            │
   └───────▲──────────▲──────────▲──────────▲────────────┘
           │          │          │          │
        #core      #core      #core     relative
           │          │          │       import
      src/tools   src/rest   src/adapters  worker/src
      MCP tools   REST       retrieval     Cloudflare
                  handler                  Worker
           ▲
      src/server.ts  — MCP stdio host, the package `bin`
```

Core has no imports pointing upward into the hosts. Every arrow points into it. That is
now a property of the package boundary as well as the dependency graph:
`tests/corePackageBoundary.test.ts` fails if any module under `packages/core/src` imports
outside its own package, reaches a host layer, pulls a third-party dependency, or adds a
Node builtin beyond the declared `node:crypto`. `tests/coreApiContract.test.ts` and
`tests/coreEdgeBoundary.test.ts` continue to hold the public surface and the edge subset.

**Not yet true of the Worker.** `worker/src/worker.ts` imports `src/tools/evaluateContext.js`
and `src/rest/handler.js` by relative path as well as Core. The Worker bundles three layers
from TypeScript source. The honest statement today is *Core is protocol-independent; the
Worker is not yet.* Resolving that means deciding whether the REST surface belongs to Core,
to the MCP host, or to a third package — an architecture decision, not a migration mechanic.

## Package surface

| Subpath | Contents |
|---|---|
| `freshcontext-mcp` | the MCP server. **Importing it starts the stdio server** — it is a `bin` entry, not a library entry |
| `freshcontext-mcp/core` | the full evaluation engine |
| `freshcontext-mcp/core/edge` | the crypto-free subset for edge runtimes |

### How the published package reaches Core

Core's source lives in `packages/core/`, a **private, unpublished** workspace package named
`@freshcontext/core`. The root build compiles it into `dist/core/`, and the host layers under
`src/` reach it through Node subpath imports — `#core`, `#core/edge`, `#core/types` — which
resolve from `freshcontext-mcp`'s own `package.json`.

This matters for one reason: an installed copy of `freshcontext-mcp` needs nothing from the
workspace. There is no dependency on `@freshcontext/core`, published or otherwise, and
`npm run verify:tarball` proves it by installing the real tarball into a directory outside
this tree and importing every declared subpath. A manifest check alone would not be enough —
npm rewrites a `workspace:` specifier into a plain semver range at publish time, so a broken
tarball can look clean in the manifest.

`@freshcontext/core` is **not published**. Publishing it, and whatever licensing decision that
implies, is deliberately not part of this change.

Both subpaths have been public for several release lines; `docs/RELEASE_NOTES.md` records
when each was introduced. Core is directly importable through supported package subpaths: a consumer can use
`freshcontext-mcp/core` and `freshcontext-mcp/core/edge` without invoking the adapters or
the server interface. Installing the package still installs the package as a whole,
including its dependencies. A separately published Core package is a possible future step,
not a current one.

## Two revalidation clocks

`revalidate_after` names two different quantities on two different surfaces. Both are
correct. They are not two computations of one value, and neither supersedes the other.

| | Content clock | Verdict clock |
|---|---|---|
| Computed by | `decay.ts::computeRevalidateAfter` | `decision.ts::computeVerdictRevalidateAfter` |
| Anchored at | the content's publication date | the moment of evaluation |
| Half-life from | the adapter's decay constant | the source profile |
| Answers | when this **content** crosses the staleness line | when this **verdict** should be re-checked |
| May be in the past | yes — meaningfully so | no |
| Carried on | `FreshContext.revalidate_after` | `ContextDecisionResult.revalidate_after` |
| Emitted by | `stampFreshness`, the evaluation envelope | the decision path |
| Recorded in the ledger | no | **yes** — this is the attested value |

Both names are exported from `freshcontext-mcp/core`. The field names are shared for
historical reasons and are not renamed: the verdict field is inside a signed payload, so
renaming it would break verification of records already issued.

## Envelope content length

`MAX_ENVELOPE_CONTENT_LENGTH` is 20,000 characters and `clampEnvelopeMaxLength` is the
single implementation of that cap. Both envelope constructors — `stampFreshness` and the
evaluation pipeline — call it. The default when a caller supplies nothing is 8,000.
`tests/revalidationAndEnvelopeContract.test.ts` fails if the two constructors ever disagree.

## The REST option contract

`/v1/evaluate` and `/v1/evaluate-batch` accept an `options` object. Keys are enumerated
explicitly in `src/rest/handler.ts`; unknown keys are dropped rather than rejected, so a
newer client does not break against an older deployment. Adding an option to Core does not
make it a REST feature by itself.

| Option | Class |
|---|---|
| `includeEnvelope`, `envelopeMaxLength`, `envelopeFormat`, `includeProvenance` | public |
| `provenance.resultId`, `provenance.semanticFingerprint` | public |
| `provenance.engineVersion` | **public, caller-asserted** — echoed into a keyless digest the caller can recompute. It is not a FreshContext service-version claim, and the signed ledger row uses the server's own version regardless |
| `now` | public — the deterministic evaluation reference clock, used by the Context Integrity Benchmark and by callers replaying historical evaluations |
| `defaultSourceType`, `semanticWeight`, `freshnessWeight` | accepted, not documented as features |

The evaluate routes are given no ledger binding, so nothing a caller sends through them
reaches a persisted or signed record.

## Attestation

Core produces a canonical signing payload and a keyless digest; it holds no key material
and makes no network calls. Signing happens at the edge with a published Ed25519 key, and
two independent offline verifiers — one JavaScript, one Python — ship inside the package.
Retired keys still resolve, so records issued under a previous key stay verifiable.

## Source profiles

Twelve built-in profiles, a closed set. `SourceProfileId` is a string-literal union and the
MCP path rejects unknown ids. Several profile fields (`failure_policy`, `source_types`,
`recommended_surfaces`, `date_policy`) are declarative today and are not read by scoring.
Opening profiles to caller definitions would make `verdict_id` a function of caller-supplied
policy, which has attestation consequences that are not yet designed. Recorded here so the
gap is visible rather than implied.
