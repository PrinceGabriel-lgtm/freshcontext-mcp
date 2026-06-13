# FreshContext MCP Usage with Codex

This note documents the verified Codex-compatible MCP setup for the local FreshContext repository.

## What Codex can use

Codex can launch FreshContext as a local MCP server over stdio.

The verified local server entrypoint is:

```powershell
& '<node-executable>' '<repo-root>\dist\server.js'
```

The MCP server exposes 22 tools: the front-door `evaluate_context` tool plus 21 read-only reference adapters. The local smoke test verifies the package version, server version, expected tool count, the generic context-evaluation path, and representative adapter calls.

No credential is required for the local stdio smoke path.

## Local stdio setup

Prerequisites:

- Node.js 20 or newer
- Repository dependencies installed with `npm install`
- Built server output at `dist/server.js`

From the repository root:

```powershell
cd '<repo-root>'
npm install
npm run build
npm run smoke:stdio
```

For a local Codex setup, use the same Node executable and built server path validated by the smoke test:

```toml
[mcp_servers.freshcontext]
command = '<node-executable>'
args = ['<repo-root>\dist\server.js']
```

A more portable variant is also valid when `node` is available on Codex's PATH:

```toml
[mcp_servers.freshcontext]
command = "node"
args = ['<repo-root>\dist\server.js']
```

Keep this configuration in the local Codex config file, not in the repository. Do not commit machine-local paths.

## Remote /mcp setup

The repository declares a remote Streamable HTTP MCP endpoint in `server.json` and the README:

```text
https://freshcontext-mcp.gimmanuel73.workers.dev/mcp
```

For clients that need a stdio bridge to a remote MCP endpoint, the README uses `mcp-remote`:

```toml
[mcp_servers.freshcontext_remote]
command = "npx"
args = ["-y", "mcp-remote", "https://freshcontext-mcp.gimmanuel73.workers.dev/mcp"]
```

This remote path was verified on 2026-06-14 as a live Worker MCP endpoint exposing `0.3.21 / 22 tools`, including `evaluate_context`, `provenance_readiness`, `readable`, and `readable.handoff`. That confirms Worker availability and MCP tool discovery. It does not by itself claim Codex Cloud support or guarantee every MCP client can use the remote bridge without its own client-specific setup check.

## Verification steps

Run the local smoke test:

```powershell
cd '<repo-root>'
npm run smoke:stdio
```

Expected result:

```json
{
  "ok": true,
  "package_version": "0.3.21",
  "server_version": "0.3.21",
  "tool_count": 22
}
```

Run whitespace validation before committing docs:

```powershell
git diff --check
```

Expected result: no output and exit code 0.

## Safety notes

- Do not place secrets, credentials, registry tokens, npm tokens, GitHub tokens, or Cloudflare tokens in Codex MCP config.
- Do not read, edit, print, or commit local token files, local environment files, registry credentials, Cloudflare local state, or Wrangler state.
- Do not commit local Codex config or machine-specific paths.
- Prefer the local stdio path for source-checkout compatibility checks because it is verified by `npm run smoke:stdio`.
- Do not claim Codex Cloud support unless it is separately tested and documented.

## Troubleshooting

If Codex cannot start the server:

- Confirm `dist/server.js` exists. If not, run `npm run build`.
- Confirm Node is installed with `node -v`. The package requires Node.js 20 or newer.
- If `node` is not found by Codex, use the full executable path from `node -p "process.execPath"`.
- Run `npm run smoke:stdio` from the repository root and confirm `tool_count` is 22.
- If the remote setup fails, verify network access, `npx` availability, and the remote endpoint separately. Do not treat remote failure as evidence that local stdio is broken.
