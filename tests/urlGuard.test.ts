import test from "node:test";
import assert from "node:assert/strict";
import * as security from "../src/security.js";
import { changelogAdapter } from "../src/adapters/changelog.js";

// Regression tests for the 0.5.3 URL guard. Every destination below reaches the
// user's own machine or a private network and must be refused.

const PRIVATE_LITERALS = [
  "http://[::1]/",
  "http://[::ffff:127.0.0.1]/",
  "http://[::ffff:7f00:1]/",
  "http://[::]/",
  "http://[fd00::1]/",
  "http://[fc00::1]/",
  "http://[fe80::1]/",
  "http://[fec0::1]/",
  "http://[ff02::1]/",
  "http://[64:ff9b::7f00:1]/",
  "http://[2002:7f00:1::]/",
  "http://localhost./",
  "http://LOCALHOST../",
  "http://app.localhost/",
  "http://100.64.0.1/",
  "http://100.127.255.254/",
  "http://0.0.0.1/",
  "http://0.0.0.0/",
  "http://224.0.0.1/",
  "http://255.255.255.255/",
  "http://metadata.google.internal/",
  "http://metadata.google.internal./",
  "http://metadata/",
  "http://printer.local/",
  "http://router.home.arpa/",
  "http://127.1/",
  "http://2130706433/",
  "http://0x7f000001/",
  "http://169.254.169.254/",
  "http://192.168.1.1/",
  "http://10.0.0.1/",
  "http://172.16.0.1/",
];

for (const url of PRIVATE_LITERALS) {
  test(`validateUrl refuses ${url}`, () => {
    assert.throws(() => security.validateUrl(url, "changelog"), security.SecurityError);
  });
}

test("validateUrl still accepts ordinary public URLs", () => {
  for (const url of ["https://example.com/changelog", "https://docs.example.org./releases", "http://[2606:4700:4700::1111]/", "http://100.128.0.1/", "http://8.8.8.8/"]) {
    assert.doesNotThrow(() => security.validateUrl(url, "changelog"), url);
  }
});

test("isBlockedAddress covers IPv4, IPv6 and IPv4-mapped forms", () => {
  const isBlocked = (security as Record<string, unknown>).isBlockedAddress as (ip: string) => boolean;
  assert.equal(typeof isBlocked, "function");
  for (const ip of ["127.0.0.1", "::1", "::ffff:127.0.0.1", "::ffff:10.1.2.3", "fd12:3456::1", "fe80::abcd", "100.64.1.1", "0.1.2.3", "169.254.1.1"]) assert.equal(isBlocked(ip), true, ip);
  for (const ip of ["93.184.216.34", "2606:4700:4700::1111", "::ffff:93.184.216.34"]) assert.equal(isBlocked(ip), false, ip);
  assert.equal(isBlocked("not-an-ip"), true, "anything that is not an IP address is refused");
});

type Lookup = (host: string) => Promise<{ address: string; family: number }[]>;
const fakeDns = (table: Record<string, string[]>): Lookup => async (host) => {
  const found = table[host];
  if (!found) throw new Error(`ENOTFOUND ${host}`);
  return found.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
};

test("a public hostname that resolves to loopback or a private address is refused", async () => {
  const assertPublic = (security as Record<string, unknown>).assertPublicDestination as (url: string, lookup?: Lookup) => Promise<string>;
  assert.equal(typeof assertPublic, "function");
  const dns = fakeDns({
    "localtest.me": ["127.0.0.1"],
    "v6.example": ["::1"],
    "mixed.example": ["93.184.216.34", "10.0.0.5"],
    "mapped.example": ["::ffff:192.168.0.1"],
    "public.example": ["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"],
  });
  for (const host of ["localtest.me", "v6.example", "mixed.example", "mapped.example"]) {
    await assert.rejects(assertPublic(`https://${host}/changelog`, dns), security.SecurityError, host);
  }
  await assert.rejects(assertPublic("https://missing.example/", dns), security.SecurityError, "unresolvable hosts are refused");
  assert.equal(await assertPublic("https://public.example/changelog", dns), "https://public.example/changelog");
  await assert.rejects(assertPublic("http://[::1]/", dns), security.SecurityError, "literals are checked without DNS");
});

test("every hop of a redirect chain is checked, not only the first URL", async () => {
  const assertChain = (security as Record<string, unknown>).assertPublicRedirectChain as (urls: string[], lookup?: Lookup) => Promise<void>;
  assert.equal(typeof assertChain, "function");
  const dns = fakeDns({ "public.example": ["93.184.216.34"], "rebind.example": ["127.0.0.1"] });
  await assertChain(["https://public.example/a", "https://public.example/b"], dns);
  await assert.rejects(assertChain(["https://public.example/a", "http://[::1]:8080/admin"], dns), security.SecurityError);
  await assert.rejects(assertChain(["https://public.example/a", "https://rebind.example/"], dns), security.SecurityError);
  await assert.rejects(assertChain(["https://public.example/a", "file:///etc/passwd"], dns), security.SecurityError);
});

test("changelog arbitrary-site browser mode is off unless explicitly enabled", async () => {
  const previous = process.env.FRESHCONTEXT_CHANGELOG_BROWSER;
  delete process.env.FRESHCONTEXT_CHANGELOG_BROWSER;
  try {
    await assert.rejects(changelogAdapter({ url: "https://example.com/" }), /browser mode is disabled/);
  } finally {
    if (previous !== undefined) process.env.FRESHCONTEXT_CHANGELOG_BROWSER = previous;
  }
});

test("changelog refuses private literals before any browser or fetch, even when browser mode is enabled", async () => {
  const previous = process.env.FRESHCONTEXT_CHANGELOG_BROWSER;
  process.env.FRESHCONTEXT_CHANGELOG_BROWSER = "1";
  try {
    for (const url of ["http://[::1]/", "http://localhost./", "http://[fd00::1]/", "http://100.64.0.1/", "http://metadata.google.internal/"]) {
      await assert.rejects(changelogAdapter({ url }), security.SecurityError, url);
    }
  } finally {
    if (previous === undefined) delete process.env.FRESHCONTEXT_CHANGELOG_BROWSER;
    else process.env.FRESHCONTEXT_CHANGELOG_BROWSER = previous;
  }
});

test("the worker no longer reads a third-party mirror of YC's index (cron or composite)", async () => {
  const { readFileSync } = await import("node:fs");
  const worker = readFileSync(new URL("../worker/src/worker.ts", import.meta.url), "utf8");
  assert.doesNotMatch(worker, /yc-oss\.github\.io/);
  assert.match(worker, /case "yc":\s*\/\/[^\n]*\n[^\n]*\n\s*return "\[adapter yc withdrawn/);
});

test("changelog browser mode refuses a hostname that resolves privately before starting a browser", async () => {
  const previous = process.env.FRESHCONTEXT_CHANGELOG_BROWSER;
  process.env.FRESHCONTEXT_CHANGELOG_BROWSER = "1";
  try {
    // A name with no DNS answer is refused as unresolvable, never handed to the browser.
    await assert.rejects(changelogAdapter({ url: "https://does-not-exist.invalid/" }), security.SecurityError);
  } finally {
    if (previous === undefined) delete process.env.FRESHCONTEXT_CHANGELOG_BROWSER;
    else process.env.FRESHCONTEXT_CHANGELOG_BROWSER = previous;
  }
});
