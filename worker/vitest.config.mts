import { readFileSync } from "node:fs";
import { generateKeyPairSync } from "node:crypto";
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

// Integration harness for the mounted REST surface. Runs the REAL Worker wrapper in
// workerd via SELF.fetch, with a REAL local D1 for the ledger. Deliberately does NOT
// load wrangler.jsonc wholesale: the live config carries a BROWSER (Browser Rendering)
// binding that miniflare cannot provision, and the verify path never touches it. We
// provide only what /v1/verify + /v1/health need — a D1 ledger and the HMAC secret.
//
// The compatibility target is the exception. It used to be restated here as a literal,
// which meant the suite could pass on a runtime production does not run and nothing
// forced the two to agree — the same shape as every other bug in this repo's history.
// Read it out of wrangler.jsonc instead, and throw rather than silently defaulting if
// it cannot be read: a test runtime that quietly disagrees with production is worse
// than a config that refuses to load.
function compatibilityTargetFromWranglerConfig(): {
  compatibilityDate: string;
  compatibilityFlags: string[];
} {
  const path = new URL("./wrangler.jsonc", import.meta.url);
  // Whole-line // comments only, which is all wrangler.jsonc uses. Anything else and
  // JSON.parse throws, which is the intended outcome — see above.
  const stripped = readFileSync(path, "utf8").replace(/^\s*\/\/.*$/gm, "");

  let parsed: { compatibility_date?: unknown; compatibility_flags?: unknown };
  try {
    parsed = JSON.parse(stripped);
  } catch (cause) {
    throw new Error(
      "vitest.config.mts could not parse worker/wrangler.jsonc to read the compatibility " +
      "target. Refusing to fall back to a literal: the tests would then run on a different " +
      "runtime than production.",
      { cause }
    );
  }

  const { compatibility_date: date, compatibility_flags: flags } = parsed;
  if (typeof date !== "string" || date === "") {
    throw new Error("worker/wrangler.jsonc has no compatibility_date; cannot pin the test runtime.");
  }
  if (!Array.isArray(flags) || !flags.every((f) => typeof f === "string")) {
    throw new Error("worker/wrangler.jsonc has no string[] compatibility_flags; cannot pin the test runtime.");
  }

  return { compatibilityDate: date, compatibilityFlags: flags };
}

// Reading the date from wrangler.jsonc is only half the job. miniflare will accept a
// compatibility_date newer than the workerd it ships, print a WARNING, and silently run
// the suite on the older runtime anyway:
//
//   [mf:warn] The latest compatibility date supported by the installed Cloudflare Workers
//   Runtime is "2025-10-11", but you've requested "2026-09-01". Falling back to "2025-10-11"...
//
// That is the original drift wearing a disguise — the config would now name the right
// date while the tests kept running on a different one, and only a warning in the scroll-
// back would say so. Worse, the two runtimes in this tree disagree: wrangler bundles
// workerd 1.20260609.1, while @cloudflare/vitest-pool-workers pins its OWN nested
// workerd 1.20251011.0. The pool's copy is what executes the tests, so it is the ceiling.
//
// So: derive the ceiling from the runtime that will actually run, and refuse to start
// above it. The rule is "you may not ship a compatibility date your tests cannot
// execute", and raising it requires upgrading the pool — which is the correct forcing
// function, not a comment asking someone to remember.
function testRuntimeMaxCompatibilityDate(): { date: string; workerdVersion: string } {
  const candidates = [
    // The pool's own nested copy wins: it is what workerd the tests boot.
    new URL("./node_modules/@cloudflare/vitest-pool-workers/node_modules/workerd/package.json", import.meta.url),
    // Hoisted install (npm may dedupe the nested copy away).
    new URL("./node_modules/workerd/package.json", import.meta.url),
  ];

  for (const candidate of candidates) {
    let version: unknown;
    try {
      version = JSON.parse(readFileSync(candidate, "utf8")).version;
    } catch {
      continue; // Not installed at this path; try the next.
    }
    // workerd versions are 1.YYYYMMDD.N, and that date IS its max compatibility date.
    const parts = typeof version === "string" ? /^\d+\.(\d{4})(\d{2})(\d{2})\./.exec(version) : null;
    if (parts) {
      return { date: `${parts[1]}-${parts[2]}-${parts[3]}`, workerdVersion: version as string };
    }
  }

  throw new Error(
    "vitest.config.mts could not locate the workerd package to determine the maximum " +
    "compatibility date the test runtime supports. Run `npm ci` in worker/."
  );
}

const { compatibilityDate, compatibilityFlags } = compatibilityTargetFromWranglerConfig();
const runtime = testRuntimeMaxCompatibilityDate();

// ISO dates compare correctly as strings.
if (compatibilityDate > runtime.date) {
  throw new Error(
    `worker/wrangler.jsonc sets compatibility_date "${compatibilityDate}", but the workerd ` +
    `the test pool runs (${runtime.workerdVersion}) supports at most "${runtime.date}". ` +
    `miniflare would silently fall back and the suite would prove nothing about the runtime ` +
    `production actually uses. Either lower compatibility_date to "${runtime.date}" or ` +
    `upgrade @cloudflare/vitest-pool-workers so its bundled workerd covers the newer date.`
  );
}

// The Ed25519 test keypair is GENERATED HERE, per run, and never committed.
//
// It used to be a literal in the bindings below, labelled test-only. That was true, but
// GitGuardian flagged it on every push and it was going to stay flagged forever. A
// security check that is permanently red is indistinguishable from one that is broken,
// and the next real secret to land would have looked exactly like this one — so the
// answer is to remove the finding, not to silence the scanner with an ignore rule.
//
// A fresh keypair each run is also a stronger test: nothing can accidentally depend on
// one specific key's bytes. The tests read these back out of the Worker's own bindings
// (env.FC_ED25519_*) rather than restating them, which is the same
// declare-it-once-and-derive-the-rest rule the compatibility target above follows.
const TEST_KEY_ID = "fc-test-ephemeral";
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const TEST_PRIVATE_KEY_B64 = privateKey.export({ type: "pkcs8", format: "der" }).toString("base64");
const TEST_PUBLIC_KEY_B64 = publicKey.export({ type: "spki", format: "der" }).toString("base64");

// A SECOND keypair, published as retired, so rotation is actually testable rather than
// only documented. E-2 makes keys append-only: a rotated key is never removed from the
// published document, because verdicts signed under it must stay verifiable forever or
// the ledger's value evaporates. The only way to know that holds is to sign something
// with the retired key and check it still verifies.
//
// The retired PRIVATE key is exposed as a test-only binding. Production never has one:
// FC_ED25519_PUBLIC_KEYS_JSON carries public halves only, by design.
const TEST_RETIRED_KEY_ID = "fc-test-ephemeral-retired";
const retired = generateKeyPairSync("ed25519");
const TEST_RETIRED_PRIVATE_KEY_B64 = retired.privateKey.export({ type: "pkcs8", format: "der" }).toString("base64");
const TEST_RETIRED_PUBLIC_KEY_B64 = retired.publicKey.export({ type: "spki", format: "der" }).toString("base64");

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
          // Read from wrangler.jsonc — see compatibilityTargetFromWranglerConfig above.
          compatibilityDate,
          compatibilityFlags,
          d1Databases: { DB: "test-ledger" },
          bindings: {
            FC_HMAC_SECRET: "miniflare-integration-secret-not-prod",
            FC_ED25519_KEY_ID: TEST_KEY_ID,
            FC_ED25519_PRIVATE_KEY_B64: TEST_PRIVATE_KEY_B64,
            FC_ED25519_PUBLIC_KEY_B64: TEST_PUBLIC_KEY_B64,
            FC_ED25519_PUBLIC_KEYS_JSON: JSON.stringify([
              {
                key_id: TEST_RETIRED_KEY_ID,
                algorithm: "Ed25519",
                public_key_spki_b64: TEST_RETIRED_PUBLIC_KEY_B64,
                status: "retired",
                valid_until: "2026-09-01T00:00:00Z",
              },
            ]),
            // Test scaffolding only — production has no retired PRIVATE key anywhere.
            TEST_RETIRED_PRIVATE_KEY_B64,
          },
        },
      },
    },
  },
});
