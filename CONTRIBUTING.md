# Contributing

This project is MIT licensed and contributions are welcome.

## Terms

By submitting a pull request, issue, patch, suggestion or other contribution to
this repository, you agree that:

1. **You wrote it, or you have the right to submit it.** If any part came from
   somewhere else, say so and name the licence it came under. This repository
   keeps an explicit permissive-only dependency posture — see
   `docs/DEPENDENCY_DILIGENCE.md` — and a contribution carrying a copyleft
   obligation cannot be accepted without that being stated up front.

2. **Your contribution is licensed under the MIT License**, the same terms as
   the rest of the project, as set out in `LICENSE`. This is the inbound=outbound
   convention MIT projects rely on; it is written down here so it does not have
   to be inferred.

3. **No compensation, equity, ownership interest, revenue share or future
   consideration of any kind arises from contributing.** Contributions are
   voluntary. Nothing in this repository, and no discussion about it, creates a
   partnership, joint venture, employment or agency relationship.

4. **Feedback is not a contribution of ownership.** Comments, ideas, bug
   reports, feature requests, benchmark suggestions and review remarks may be
   used freely, without attribution or payment.

Points 3 and 4 are stated because they are usually left implicit, and "usually
implicit" is what becomes expensive to establish years later. They are not a
comment on anyone who has contributed: at the time of writing, every commit in
this repository was authored by the maintainer.

Use of the FreshContext name and marks is governed separately by
`TRADEMARKS.md`. The MIT licence covers the code, not the branding, and
contributing does not grant a right to imply endorsement.

## Practically

```bash
npm ci
npm run build
npm test          # 417 tests; the runner enumerates files explicitly
npm run trust:gate
```

- **A new test file is not run until it is registered.** `npm test` reads a
  hardcoded path array in `package-script-guard.mjs` rather than a glob, so an
  unregistered test passes silently by never executing. Add yours to that array
  in the same commit.
- **Claims are scanned.** `npm run trust:gate` checks public claims against the
  code — tool counts, version constants, the Ha-Pri v2 boundary. If it flags
  something you wrote, the usual fix is the claim, not the allowlist. Exceptions
  go in `config/trust-scan-allowlist.json` with a written reason.
- **Do not raise a claim the code does not implement.** `docs/TECHNICAL_EVIDENCE.md`
  maps each public claim to the artifact that proves it. A pull request that adds
  a claim should add or point at the thing that checks it.
- The benchmark under `benchmarks/context-integrity-v1/` is a regression
  contract. If a rate moves, something in the engine moved — say which in the
  pull request rather than updating the expected value.

## Security

Do not open a public issue for a vulnerability. `SECURITY.md` has the process
and the address.
