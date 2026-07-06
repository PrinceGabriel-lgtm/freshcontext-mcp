import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

// Integration harness for the mounted REST surface (F3). Runs the REAL Worker in
// workerd via SELF.fetch, with a REAL local D1 for the ledger. Deliberately does NOT
// load wrangler.jsonc: the live config carries a BROWSER (Browser Rendering) binding
// that miniflare cannot provision, and the verify path never touches it. We provide
// only what /v1/verify + /v1/health need — a D1 ledger and the HMAC secret.
export default defineWorkersConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // The full Worker bundle drags in ajv (a CJS package, via the MCP SDK's validation
    // provider) whose internals (a JSON require inside dist/core.js) the workers pool's
    // module-by-module resolution can't handle. Per Cloudflare's documented workaround
    // (vitest-integration/known-issues#module-resolution), pre-bundle it with the SSR
    // deps optimizer so esbuild flattens it into one file before the pool sees it.
    deps: {
      optimizer: {
        ssr: {
          enabled: true,
          include: ["ajv", "ajv-formats"],
        },
      },
    },
    poolOptions: {
      workers: {
        main: "./src/worker.ts",
        miniflare: {
          compatibilityDate: "2024-09-23",
          compatibilityFlags: ["nodejs_compat_v2"],
          d1Databases: { DB: "test-ledger" },
          bindings: {
            FC_HMAC_SECRET: "miniflare-integration-secret-not-prod",
          },
        },
      },
    },
  },
});
