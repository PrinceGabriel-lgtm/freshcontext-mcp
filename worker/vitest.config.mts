import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

// Integration harness for the mounted REST surface. Runs the REAL Worker wrapper in
// workerd via SELF.fetch, with a REAL local D1 for the ledger. Deliberately does NOT
// load wrangler.jsonc: the live config carries a BROWSER (Browser Rendering) binding
// that miniflare cannot provision, and the verification path never touches it.
//
// The Ed25519 keypair below is TEST-ONLY. It was generated specifically for this fixture
// and is safe to commit; production keys must never be committed to the repository.
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
        main: "./src/worker-e2.ts",
        miniflare: {
          compatibilityDate: "2024-09-23",
          compatibilityFlags: ["nodejs_compat_v2"],
          d1Databases: { DB: "test-ledger" },
          bindings: {
            FC_HMAC_SECRET: "miniflare-integration-secret-not-prod",
            FC_ED25519_KEY_ID: "fc-test-2026-09",
            FC_ED25519_PRIVATE_KEY_B64: "MC4CAQAwBQYDK2VwBCIEICysCF/82Ccv4o4HQf4xJdYoGC8FfpFbcQrgfZUonk5q",
            FC_ED25519_PUBLIC_KEY_B64: "MCowBQYDK2VwAyEAWaIFrc+B+rHA/Sk5Fco3UWUq2wuBHGsU/fDgWLXmvaE=",
          },
        },
      },
    },
  },
});
