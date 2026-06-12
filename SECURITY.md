# Security Policy

## Supported Versions

FreshContext currently supports the active `freshcontext-mcp@0.3.x` package line.

Please use the latest published `0.3.x` release when reporting a vulnerability, and include the exact package version, repository, transport, and environment involved.

## Reporting A Vulnerability

FreshContext accepts responsible security reports by email:

- gimmanuel73@gmail.com

Please do not post secrets, tokens, private logs, customer data, exploit payloads, or sensitive operational details in public GitHub issues.

For a useful report, include:

- affected repository or package
- affected version or commit
- reproduction steps
- expected and observed behavior
- security impact
- whether the issue affects local MCP usage, hosted Worker usage, examples, docs, packaging, or another surface

Public GitHub issues are fine for non-sensitive bugs, documentation mistakes, stale claims, build failures, and feature requests.

## Scope Notes

FreshContext does not currently offer a formal bug bounty program.

Please do not send live production tokens, private Cloudflare logs, npm tokens, GitHub tokens, MCP registry tokens, customer data, or private account data. If a report requires sensitive evidence, describe the issue first by email so a safer exchange path can be agreed.

FreshContext's primary `evaluate_context` path evaluates caller-provided candidate context and does not fetch, crawl, browse, read folders, or call adapters. The published MCP package also includes read-only reference adapters that use network access only when those adapter tools are invoked.

This policy does not make claims of certification, compliance, guaranteed response time, or security warranty.
