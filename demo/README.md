# FreshContext - Illustrative Demo

> **Same model. Same retrieval set. Same query. Two different answers, because one ranking path preserved source age and the other did not.**

A 5-document illustrative demo built from a mock retrieval set. It shows how FreshContext treats freshness signals; it is not a claim about current RAG best practice.

## What's in this folder

| File | Purpose |
|------|---------|
| `index.html` | The shareable demo page. Serve the folder locally or host it statically so `data.json` can load. |
| `data.json` | The mock retrieval set (5 documents, mixed timestamps, semantic scores). |
| `generate.mjs` | Calls the live Anthropic API to regenerate the two answers for comparison. |
| `README.md` | This file. |

## View the demo

Serve the folder with a local static server, then open the served page in a browser. The page fetches `data.json`, and some browsers block that fetch from `file://` URLs. R<sub>t</sub> is computed live on page load, so the math stays current as documents age.

```bash
npx serve .
```

To share it as a link:

- **Cloudflare Pages:** drop the `demo/` folder into a Pages project — done.
- **GitHub Pages:** push `demo/` to a `gh-pages` branch.
- **Static host:** any S3, Netlify, or Vercel deploy works. No build step.

## Regenerate the illustrative answers

The two answers in `index.html` are pre-baked illustrative outputs. You can compare them with a live Claude API call:

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
3. Builds two prompts - one with the top-3 by R<sub>0</sub> (semantic), one with the top-3 by R<sub>t</sub> (decay-adjusted)
4. Calls `claude-sonnet-4-6` for both
5. Prints both answers side-by-side

You should see the same kind of divergence the demo shows: when the top context changes, the model's answer usually follows the context it was given.

## What this demonstrates

- **It's not a model-certification claim.** The demo shows how a model can faithfully summarize stale context.
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
