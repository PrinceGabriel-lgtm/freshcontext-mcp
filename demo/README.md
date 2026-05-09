# FreshContext — Live Demo

> **Same model. Same retrieval set. Same query. Two completely different answers — because one of them remembered when its sources were written.**

A 5-document demonstration of why semantic-only retrieval gives 2026 systems 2022 answers — and what it costs to fix it.

## What's in this folder

| File | Purpose |
|------|---------|
| `index.html` | The shareable demo. Self-contained, no server needed. Open in any browser. |
| `data.json` | The mock retrieval set (5 documents, mixed timestamps, semantic scores). |
| `generate.mjs` | Calls the live Anthropic API to regenerate the two answers — proves they aren't hand-written. |
| `README.md` | This file. |

## View the demo

Open `index.html` in any browser. R<sub>t</sub> is computed live on page load, so the math stays current as documents age.

To share it as a link:

- **Cloudflare Pages:** drop the `demo/` folder into a Pages project — done.
- **GitHub Pages:** push `demo/` to a `gh-pages` branch.
- **Static host:** any S3, Netlify, or Vercel deploy works. No build step.

## Verify the answers are real

The two answers in `index.html` are pre-baked. To prove they aren't hand-written, regenerate them with a real Claude API call:

```powershell
# PowerShell
$env:ANTHROPIC_API_KEY = "sk-ant-..."
node generate.mjs
```

```bash
# bash / zsh
ANTHROPIC_API_KEY=sk-ant-... node generate.mjs
```

The script:

1. Loads `data.json`
2. Computes R<sub>t</sub> for every document
3. Builds two prompts — one with the top-3 by R<sub>0</sub> (semantic), one with the top-3 by R<sub>t</sub> (decay-adjusted)
4. Calls `claude-sonnet-4-6` for both
5. Prints both answers side-by-side

You'll see the same kind of divergence the demo shows. Different versions of Claude will phrase it differently, but the *direction* of the change is structurally guaranteed: whatever the top-3 says, that's what the model anchors on.

## What this demonstrates

- **It's not a model problem.** Claude isn't wrong in the baseline — it faithfully summarized stale context.
- **It's not an embedding problem.** Cosine similarity scores were correct.
- **It's a context-engineering problem.** Retrieval ranks correctly along one axis (semantic similarity) and ignores another axis that matters in production (temporal validity).

> Most RAG pipelines rank context correctly semantically but incorrectly temporally.

## Run it against your own data

Replace `data.json` with your own retrieval output. The shape is documented inline. The HTML and the script will pick up your new query, your documents, your timestamps. The math doesn't change.

## Where this comes from

- Repo: <https://github.com/PrinceGabriel-lgtm/freshcontext-mcp>
- Spec: <https://freshcontext-site.pages.dev>
- npm: `npm install freshcontext-mcp`
- Live API: `https://freshcontext-mcp.gimmanuel73.workers.dev/v1/intel/feed/default`

Built by Immanuel Gabriel · Grootfontein, Namibia · MIT licensed.
