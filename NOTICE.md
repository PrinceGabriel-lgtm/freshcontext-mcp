# FreshContext Notice

FreshContext is the project and software package distributed from this repository:

https://github.com/PrinceGabriel-lgtm/freshcontext-mcp

FreshContext is licensed under the MIT License as stated in `LICENSE` and package metadata.

Third-party dependencies retain their own licenses, notices, copyrights, and attribution requirements. FreshContext does not claim ownership of third-party packages, services, trademarks, APIs, registries, or data sources referenced by the project.

Before any commercial transfer, sale, assignment, or packaged diligence review, rerun dependency and license inventory checks and review third-party attribution obligations with appropriate professional support.

This notice does not grant trademark registration, partnership status, certification, compliance status, or rights in third-party names.

## Operational Data

The production D1 database holds a `user_profiles` row with `id = 'default'`. It is a
single scoring-preference row — interests, skills, location — used by the
signal-intelligence and briefing paths to rank signals. It is read by the Worker and
seeded by hand; no code path in this repository writes it, which is why it can look
orphaned in a schema read.

It holds the current maintainer's own preferences, not third-party data. On any
transfer it should be cleared or replaced by the receiving party rather than handed
over: the code falls back to a built-in default profile when the row is absent, so
removing it changes no behaviour.

Verdict rows (`evaluation_snapshots`) are a separate matter and contain no
caller-supplied content — content is hashed into `canonical_content_sha256` before it
enters the signed payload.

Security reports and trust questions may be sent to:

security@freshcontext.dev
