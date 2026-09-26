/**
 * freshcontext-mcp security module
 * Input sanitization, domain allowlists, and request validation
 */

import { BlockList, isIP } from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";

// ─── Allowed domains per adapter ────────────────────────────────────────────

export const ALLOWED_DOMAINS: Record<string, string[]> = {
  github: ["github.com", "raw.githubusercontent.com"],
  scholar: ["scholar.google.com"],
  hackernews: ["news.ycombinator.com", "hn.algolia.com"],
  yc: ["www.ycombinator.com", "ycombinator.com"],
  repoSearch: [],    // uses GitHub API directly, no browser
  packageTrends: [], // uses npm/PyPI APIs directly, no browser
  reddit: ["www.reddit.com", "reddit.com", "old.reddit.com"],
  finance: [],       // uses Stooq quote API, no browser
  arxiv: ["export.arxiv.org", "arxiv.org"],
  productHunt: ["www.producthunt.com", "producthunt.com"],
  changelog: [],     // accepts public changelog URLs but blocks private/internal targets
};

// ─── Blocked IP ranges and internal hostnames ────────────────────────────────
//
// Checks are made on parsed addresses, not on hostname strings, so bracketed IPv6
// ("[::1]"), IPv4-mapped IPv6 ("::ffff:127.0.0.1") and trailing-dot hosts
// ("localhost.") cannot slip past a pattern. Hostnames are also resolved and every
// resolved address is checked (see assertPublicDestination).

const BLOCKED_V4 = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],        // "this network"
  ["10.0.0.0", 8],       // RFC 1918
  ["100.64.0.0", 10],    // CGNAT, often internal in cloud networks
  ["127.0.0.0", 8],      // loopback
  ["169.254.0.0", 16],   // link-local, cloud metadata
  ["172.16.0.0", 12],    // RFC 1918
  ["192.0.0.0", 24],     // IETF protocol assignments
  ["192.0.2.0", 24],     // documentation
  ["192.168.0.0", 16],   // RFC 1918
  ["198.18.0.0", 15],    // benchmarking
  ["198.51.100.0", 24],  // documentation
  ["203.0.113.0", 24],   // documentation
  ["224.0.0.0", 4],      // multicast
  ["240.0.0.0", 4],      // reserved, includes broadcast
] as const) BLOCKED_V4.addSubnet(net, prefix, "ipv4");

const BLOCKED_V6 = new BlockList();
for (const [net, prefix] of [
  ["::", 96],            // unspecified, loopback and IPv4-compatible
  ["100::", 64],         // discard
  ["2001:db8::", 32],    // documentation
  ["fc00::", 7],         // unique local
  ["fe80::", 10],        // link-local
  ["fec0::", 10],        // site-local (deprecated)
  ["ff00::", 8],         // multicast
] as const) BLOCKED_V6.addSubnet(net, prefix, "ipv6");

// Names that only ever mean "this machine" or "this private network".
const BLOCKED_HOST_SUFFIXES = ["localhost", "local", "internal", "home.arpa", "lan", "intranet", "corp"];

/** Expands an IPv6 address (optionally with a dotted IPv4 tail) into eight 16-bit groups. */
function ipv6Groups(ip: string): number[] | null {
  let text = ip.toLowerCase().split("%")[0];
  const v4Tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (v4Tail) {
    const o = v4Tail[1].split(".").map(Number);
    text = text.slice(0, -v4Tail[1].length) + `${((o[0] << 8) | o[1]).toString(16)}:${((o[2] << 8) | o[3]).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  const groups = [...head, ...Array(Math.max(fill, 0)).fill("0"), ...tail].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

const v4FromGroups = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;

/** True for any address that is not a routable public unicast address. Non-addresses are refused. */
export function isBlockedAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return BLOCKED_V4.check(ip, "ipv4");
  if (kind !== 6) return true;
  const g = ipv6Groups(ip);
  if (!g) return true;
  // Forms that embed an IPv4 address are judged by that address.
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return isBlockedAddress(v4FromGroups(g[6], g[7])); // ::ffff:a.b.c.d
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isBlockedAddress(v4FromGroups(g[6], g[7])); // NAT64
  if (g[0] === 0x2002) return isBlockedAddress(v4FromGroups(g[1], g[2])); // 6to4
  return BLOCKED_V6.check(g.map((x) => x.toString(16)).join(":"), "ipv6");
}

/** Lowercases, removes IPv6 brackets and trailing dots. */
function normalizeHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1").replace(/\.+$/, "");
}

function assertPublicHostLiteral(host: string): void {
  if (isIP(host)) {
    if (isBlockedAddress(host)) throw new SecurityError(`Access to internal/private addresses is not permitted: ${host}`);
    return;
  }
  // A name without a dot resolves through local search domains to LAN hosts ("metadata", "router").
  if (!host.includes(".") || BLOCKED_HOST_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`))) {
    throw new SecurityError(`Access to internal/private addresses is not permitted: ${host}`);
  }
}

// ─── Max length limits ────────────────────────────────────────────────────────

export const MAX_URL_LENGTH = 500;
export const MAX_QUERY_LENGTH = 200;
export const MAX_PACKAGES_LENGTH = 300;

// ─── Validation errors ───────────────────────────────────────────────────────

export class SecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecurityError";
  }
}

// ─── URL validator ───────────────────────────────────────────────────────────

export function validateUrl(
  rawUrl: string,
  adapterName: keyof typeof ALLOWED_DOMAINS
): string {
  // Length check
  if (!rawUrl || rawUrl.trim().length === 0) {
    throw new SecurityError("URL cannot be empty");
  }
  if (rawUrl.length > MAX_URL_LENGTH) {
    throw new SecurityError(
      `URL exceeds maximum length of ${MAX_URL_LENGTH} characters`
    );
  }

  // Must be a valid URL
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new SecurityError(`Invalid URL format: ${rawUrl}`);
  }

  // Must use http or https
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new SecurityError(
      `Protocol not allowed: ${parsed.protocol}. Only http/https permitted.`
    );
  }

  const hostname = normalizeHost(parsed.hostname);

  // Block internal/private IPs and hostnames
  assertPublicHostLiteral(hostname);

  // Domain allowlist check (skip if allowlist is empty — means no browser used)
  const allowedDomains = ALLOWED_DOMAINS[adapterName];
  if (allowedDomains && allowedDomains.length > 0) {
    const isAllowed = allowedDomains.some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`)
    );
    if (!isAllowed) {
      throw new SecurityError(
        `Domain not allowed for ${adapterName} adapter: ${hostname}. ` +
          `Allowed domains: ${allowedDomains.join(", ")}`
      );
    }
  }

  return parsed.toString();
}

// ─── Resolved-address checks ────────────────────────────────────────────────

export type AddressLookup = (hostname: string) => Promise<{ address: string; family: number }[]>;
const systemLookup: AddressLookup = (hostname) => dnsLookup(hostname, { all: true, verbatim: true });

/**
 * validateUrl, then resolves the hostname and refuses the URL if ANY resolved address
 * is private, loopback, link-local or otherwise non-public. Returns the validated URL.
 *
 * Residual risk: the browser resolves the name again when it connects, so a DNS answer
 * that changes between the two lookups (rebinding) is not fully excluded. Callers re-check
 * every request and redirect hop to narrow that window.
 */
export async function assertPublicDestination(rawUrl: string, lookup: AddressLookup = systemLookup): Promise<string> {
  const safe = validateUrl(rawUrl, "changelog");
  const host = normalizeHost(new URL(safe).hostname);
  if (isIP(host)) return safe;
  let addresses: { address: string }[];
  try {
    addresses = await lookup(host);
  } catch {
    throw new SecurityError(`Could not resolve ${host}; refusing to fetch it`);
  }
  if (addresses.length === 0) throw new SecurityError(`Could not resolve ${host}; refusing to fetch it`);
  for (const { address } of addresses) {
    if (isBlockedAddress(address)) {
      throw new SecurityError(`Access to internal/private addresses is not permitted: ${host} resolves to ${address}`);
    }
  }
  return safe;
}

/** Checks every URL in a redirect chain (first request to final response). */
export async function assertPublicRedirectChain(urls: string[], lookup: AddressLookup = systemLookup): Promise<void> {
  for (const url of urls) await assertPublicDestination(url, lookup);
}

// ─── Query string sanitizer ──────────────────────────────────────────────────

export function sanitizeQuery(query: string, maxLength = MAX_QUERY_LENGTH): string {
  if (!query || query.trim().length === 0) {
    throw new SecurityError("Query cannot be empty");
  }

  const trimmed = query.trim().slice(0, maxLength);

  // Strip null bytes and control characters
  const cleaned = trimmed.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

  if (cleaned.length === 0) {
    throw new SecurityError("Query contains no valid characters after sanitization");
  }

  return cleaned;
}

// ─── Package name sanitizer ──────────────────────────────────────────────────

export function sanitizePackages(input: string): string {
  if (!input || input.trim().length === 0) {
    throw new SecurityError("Package name cannot be empty");
  }

  if (input.length > MAX_PACKAGES_LENGTH) {
    throw new SecurityError(
      `Package input exceeds maximum length of ${MAX_PACKAGES_LENGTH} characters`
    );
  }

  // Only allow valid npm/PyPI package name characters, commas, colons (for npm:/pypi: prefix)
  const cleaned = input
    .trim()
    .replace(/[^a-zA-Z0-9@/._\-,:]/g, "")
    .slice(0, MAX_PACKAGES_LENGTH);

  if (cleaned.length === 0) {
    throw new SecurityError("Package name contains no valid characters after sanitization");
  }

  return cleaned;
}

// ─── Error formatter ─────────────────────────────────────────────────────────

export function formatSecurityError(err: unknown): string {
  if (err instanceof SecurityError) {
    return `[Security] ${err.message}`;
  }
  if (err instanceof Error) {
    return `[Error] ${err.message}`;
  }
  return "[Error] Unknown error occurred";
}

