# FreshContext Client Setup

FreshContext is live as an MCP stdio package on npm.

Use this guide when connecting Claude Desktop, Codex, or another MCP-compatible client to the published package.

## What You Should See

FreshContext `0.3.21` exposes:

```text
22 tools = evaluate_context + 21 read-only reference adapters
```

The primary interface is:

```text
evaluate_context
```

Use it when another retriever, agent, database, note parser, PDF extractor, or local script already has candidate context and needs FreshContext to judge what deserves to reach the model.

## Claude Desktop: Published Package

Add this to your Claude Desktop config, then restart Claude.

macOS:

```text
~/Library/Application Support/Claude/claude_desktop_config.json
```

Windows:

```text
%APPDATA%\Claude\claude_desktop_config.json
```

Config:

```json
{
  "mcpServers": {
    "freshcontext": {
      "command": "npx",
      "args": ["-y", "freshcontext-mcp@latest"]
    }
  }
}
```

If you previously installed an older global package, refresh it:

```bash
npm install -g freshcontext-mcp@latest
```

Then this config is also valid when the global npm bin path is visible to Claude:

```json
{
  "mcpServers": {
    "freshcontext": {
      "command": "freshcontext-mcp",
      "args": []
    }
  }
}
```

## Codex: Local MCP Config

For Codex local MCP config, use the published package through `npx`:

```toml
[mcp_servers.freshcontext]
command = "npx"
args = ["-y", "freshcontext-mcp@latest"]
```

If you prefer a source checkout while developing FreshContext itself:

```toml
[mcp_servers.freshcontext]
command = "node"
args = ["C:\\Users\\YOUR_USERNAME\\path\\to\\freshcontext-mcp\\dist\\server.js"]
```

Keep local MCP config files out of git. Do not commit machine-specific paths or credentials.

## Source Checkout Setup

Use this when contributing to FreshContext itself:

```bash
git clone https://github.com/PrinceGabriel-lgtm/freshcontext-mcp
cd freshcontext-mcp
npm install
npm run build
npm run smoke:stdio
```

Expected smoke result:

```json
{
  "ok": true,
  "package_version": "0.3.21",
  "server_version": "0.3.21",
  "tool_count": 22
}
```

## Remote Worker Boundary

The repository also declares a remote Streamable HTTP MCP endpoint:

```text
https://freshcontext-mcp.gimmanuel73.workers.dev/mcp
```

Some clients can use `mcp-remote`:

```json
{
  "mcpServers": {
    "freshcontext-remote": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://freshcontext-mcp.gimmanuel73.workers.dev/mcp"]
    }
  }
}
```

The npm/local stdio package remains the safest default client path. The hosted Worker endpoint was verified on 2026-06-12 at `0.3.20 / 22 tools` with `evaluate_context` present and returning decision-first output. Because the Worker is a separate deployment surface, re-run remote verification before claiming future package interfaces are live there.

## ChatGPT / OpenAI Connector Boundary

Claude and Codex MCP paths are documented now.

ChatGPT connector compatibility requires a separate search/fetch compatibility audit before being claimed. Do not assume ChatGPT connector support from Claude/Codex MCP compatibility alone.

## Quick Test Prompt

After connecting a client, ask it to use `evaluate_context` with this candidate context:

```json
{
  "profile": "academic_research",
  "intent": "citation_check",
  "signals": [
    {
      "title": "Fresh research source",
      "content": "A relevant academic source with a reliable publication date.",
      "source": "https://arxiv.org/abs/2605.12345",
      "source_type": "arxiv",
      "published_at": "2026-05-24T12:00:00.000Z",
      "retrieved_at": "2026-05-24T13:00:00.000Z",
      "semantic_score": 0.94,
      "date_confidence": "high"
    }
  ]
}
```

Expected result: decision-first output with a decision, meaning, action, warnings, supporting scores, and a structured FreshContext evaluation JSON block.
