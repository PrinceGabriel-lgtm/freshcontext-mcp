# Contributing

FreshContext accepts bug reports, feature requests, review comments, and ordinary project feedback through the repository's normal issue and pull-request channels.

Material external code, documentation, specifications, benchmark content, datasets, or other authored contributions are handled on a controlled basis. **Please do not submit a material contribution unless it has been discussed and approved in advance.** Before any material external contribution is accepted, the project may require rights-clearance information and written contribution terms appropriate to that contribution.

## Contribution boundary

By opening an issue, discussion, or pull request, you are not automatically transferring ownership of independently existing technology, third-party confidential information, or other material you do not have authority to submit.

For any material contribution considered for acceptance:

1. **Rights must be clear.** You must have the right to submit the material and must disclose relevant third-party code, content, licences, or restrictions. Material with unclear provenance or incompatible obligations will not be merged.

2. **Acceptance is not automatic.** Submission, review, discussion, or technical usefulness does not require FreshContext to accept, merge, publish, maintain, compensate for, or commercialize the contribution.

3. **Contribution terms are confirmed before acceptance.** The repository's existing published material remains subject to its stated licences, including the MIT licence where applicable. A new material external contribution will not be merged merely on an assumed inbound-licence theory; any rights or licence needed for acceptance will be confirmed as part of the contribution review.

4. **No compensation or relationship arises merely from submission.** Unless a separate written agreement says otherwise, submitting or discussing a contribution does not create compensation, equity, ownership interest, revenue share, future consideration, employment, partnership, joint venture, agency, or similar relationship.

## Ordinary feedback

Bug reports, feature requests, interoperability observations, benchmark suggestions, and review comments are welcome. They may inform FreshContext's product and engineering decisions. This does not claim ownership of a submitter's independently existing technology, confidential information, or third-party material, and it does not override any separate written agreement.

Do not include third-party confidential information, personal secrets, credentials, private keys, or material you are not authorized to disclose.

Use of the FreshContext name and marks is governed separately by `TRADEMARKS.md`. Open-source rights granted by the repository's licence do not grant a right to imply endorsement or ownership of the FreshContext marks.

## Engineering expectations

From a source checkout:

```bash
npm ci
npm run build
npm test
npm run trust:gate
```

- New tests must be registered according to the current test-runner configuration; do not rely on an unregistered test file being discovered automatically.
- Public claims should remain tied to reproducible evidence. `docs/TECHNICAL_EVIDENCE.md` maps material technical claims to the artifact or check used to verify them.
- Scanner findings should be fixed at the source where possible. Exceptions belong in the reviewed allowlist with a written reason, not as a substitute for correcting a bad claim or overly broad rule.
- Benchmark changes should explain why measured behavior moved rather than silently rewriting the expected result.

## Security

Do not open a public issue for a vulnerability or suspected secret exposure. Follow the process in `SECURITY.md`.
