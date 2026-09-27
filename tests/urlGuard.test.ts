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

test("the added ranges are refused: SIIT, local NAT64, Teredo, 6to4 relay", () => {
  const isBlocked = (security as Record<string, unknown>).isBlockedAddress as (ip: string) => boolean;
  for (const ip of ["::ffff:0:127.0.0.1", "::ffff:0:7f00:1", "64:ff9b:1::1", "2001:0:4136:e378::1", "192.88.99.1"]) assert.equal(isBlocked(ip), true, ip);
});

test("changelog never drives a browser to an arbitrary website, whatever the environment says", async () => {
  const previous = process.env.FRESHCONTEXT_CHANGELOG_BROWSER;
  process.env.FRESHCONTEXT_CHANGELOG_BROWSER = "1";
  try {
    for (const url of ["https://example.com/", "https://example.com/changelog", "https://evil.example/github.com/a/b"]) {
      await assert.rejects(changelogAdapter({ url }), /removed in 0\.5\.3/, url);
    }
    for (const url of ["http://[::1]/", "http://localhost./", "http://[fd00::1]/", "http://100.64.0.1/", "http://metadata.google.internal/"]) {
      await assert.rejects(changelogAdapter({ url }), security.SecurityError, url);
    }
  } finally {
    if (previous === undefined) delete process.env.FRESHCONTEXT_CHANGELOG_BROWSER;
    else process.env.FRESHCONTEXT_CHANGELOG_BROWSER = previous;
  }
});

test("the changelog adapter has no browser code left", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../src/adapters/changelog.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /playwright|chromium|page\.goto/);
});

test("YC is withdrawn on every path: local adapter, worker tool, composite helper and cron", async () => {
  const { ycAdapter } = await import("../src/adapters/yc.js");
  await assert.rejects(ycAdapter({ url: "https://www.ycombinator.com/companies?query=mcp" }), /withdrawn in 0\.5\.3 pending review of source terms/);
  const { readFileSync } = await import("node:fs");
  const local = readFileSync(new URL("../src/adapters/yc.ts", import.meta.url), "utf8");
  assert.doesNotMatch(local, /playwright|chromium|goto/);
  const worker = readFileSync(new URL("../worker/src/worker.ts", import.meta.url), "utf8");
  assert.doesNotMatch(worker, /yc-oss\.github\.io/);
  assert.doesNotMatch(worker, /ycombinator\.com\/companies\?query=\$\{/, "no YC fetch built from user input");
  const ycTool = worker.slice(worker.indexOf('server.registerTool("extract_yc"'), worker.indexOf('server.registerTool("search_repos"'));
  assert.doesNotMatch(ycTool, /puppeteer|goto|fetch\(/);
  assert.match(worker, /case "yc":[^\n]*\n[^\n]*\n\s*return "\[adapter yc withdrawn\]";/);
  assert.doesNotMatch(worker + local, /terms forbid/i, "no statement about the source's terms in code comments");
});

test("the hosted HN tool fetches an Algolia API URL only when its host is exactly hn.algolia.com", async () => {
  const { readFileSync } = await import("node:fs");
  const worker = readFileSync(new URL("../worker/src/worker.ts", import.meta.url), "utf8");
  assert.match(worker, /parsedInput\.hostname === "hn\.algolia\.com" && parsedInput\.protocol === "https:"/);
  assert.doesNotMatch(worker, /if \(parsedInput && url\.includes\("\/api\/"\)\) \{\s*apiUrl = url;/);
});
