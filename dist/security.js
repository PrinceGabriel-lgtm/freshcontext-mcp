/**
 * freshcontext-mcp security module
 * Input sanitization, domain allowlists, and request validation
 */
// ─── Allowed domains per adapter ────────────────────────────────────────────
export const ALLOWED_DOMAINS = {
    github: ["github.com", "raw.githubusercontent.com"],
    scholar: ["scholar.google.com"],
    hackernews: ["news.ycombinator.com", "hn.algolia.com"],
    yc: ["www.ycombinator.com", "ycombinator.com"],
    repoSearch: [], // uses GitHub API directly, no browser
    packageTrends: [], // uses npm/PyPI APIs directly, no browser
    reddit: [], // uses public Reddit JSON API, no browser
    finance: [], // uses Yahoo Finance API, no browser
    productHunt: ["www.producthunt.com", "producthunt.com"],
};
// ─── Blocked IP ranges and internal hostnames ────────────────────────────────
const BLOCKED_PATTERNS = [
    /^localhost$/i,
    /^127\.\d+\.\d+\.\d+$/,
    /^10\.\d+\.\d+\.\d+$/,
    /^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/,
    /^192\.168\.\d+\.\d+$/,
    /^169\.254\.\d+\.\d+$/, // AWS metadata
    /^0\.0\.0\.0$/,
    /^::1$/,
    /^fc00:/i,
    /^fe80:/i,
];
// ─── Max length limits ────────────────────────────────────────────────────────
export const MAX_URL_LENGTH = 500;
export const MAX_QUERY_LENGTH = 200;
export const MAX_PACKAGES_LENGTH = 300;
// ─── Validation errors ───────────────────────────────────────────────────────
export class SecurityError extends Error {
    constructor(message) {
        super(message);
        this.name = "SecurityError";
    }
}
// ─── URL validator ───────────────────────────────────────────────────────────
export function validateUrl(rawUrl, adapterName) {
    // Length check
    if (!rawUrl || rawUrl.trim().length === 0) {
        throw new SecurityError("URL cannot be empty");
    }
    if (rawUrl.length > MAX_URL_LENGTH) {
        throw new SecurityError(`URL exceeds maximum length of ${MAX_URL_LENGTH} characters`);
    }
    // Must be a valid URL
    let parsed;
    try {
        parsed = new URL(rawUrl.trim());
    }
    catch {
        throw new SecurityError(`Invalid URL format: ${rawUrl}`);
    }
    // Must use http or https
    if (!["http:", "https:"].includes(parsed.protocol)) {
        throw new SecurityError(`Protocol not allowed: ${parsed.protocol}. Only http/https permitted.`);
    }
    const hostname = parsed.hostname.toLowerCase();
    // Block internal/private IPs and hostnames
    for (const pattern of BLOCKED_PATTERNS) {
        if (pattern.test(hostname)) {
            throw new SecurityError(`Access to internal/private addresses is not permitted: ${hostname}`);
        }
    }
    // Domain allowlist check (skip if allowlist is empty — means no browser used)
    const allowedDomains = ALLOWED_DOMAINS[adapterName];
    if (allowedDomains && allowedDomains.length > 0) {
        const isAllowed = allowedDomains.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
        if (!isAllowed) {
            throw new SecurityError(`Domain not allowed for ${adapterName} adapter: ${hostname}. ` +
                `Allowed domains: ${allowedDomains.join(", ")}`);
        }
    }
    return parsed.toString();
}
// ─── Query string sanitizer ──────────────────────────────────────────────────
export function sanitizeQuery(query, maxLength = MAX_QUERY_LENGTH) {
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
export function sanitizePackages(input) {
    if (!input || input.trim().length === 0) {
        throw new SecurityError("Package name cannot be empty");
    }
    if (input.length > MAX_PACKAGES_LENGTH) {
        throw new SecurityError(`Package input exceeds maximum length of ${MAX_PACKAGES_LENGTH} characters`);
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
export function formatSecurityError(err) {
    if (err instanceof SecurityError) {
        return `[Security] ${err.message}`;
    }
    if (err instanceof Error) {
        return `[Error] ${err.message}`;
    }
    return "[Error] Unknown error occurred";
}
