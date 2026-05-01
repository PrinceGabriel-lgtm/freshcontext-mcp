# HN Throwaway Post — Friday 2026-05-01

**Strategy:** Test the water. Don't burn the main launch. Ship a small concrete story about ops, not a product reveal.

**Risk if it flops:** None. It's a sysadmin war story.
**Upside if it lands:** Small audience awareness before the Tuesday Show HN.

---

## Title options

1. `My Cloudflare Worker hit 309k errors/day from bot scanners. A 40-line filter dropped it 87% in 6 hours.`
2. `A 410 Gone filter beat my 100% error rate on a public Workers.dev URL`
3. `Ask HN: How are you handling bot-scanner traffic on public Cloudflare Workers?`

**Pick #1.** Specific number in the title. Clear before/after. No product name.

(#3 is also fine if you want pure discussion with no claim attached. Lower ceiling but lower floor.)

---

## Body

I deployed an MCP server to a `.workers.dev` URL ~57 days ago and forgot to look at the metrics until this week.

Cloudflare dashboard showed 309k requests / 309k errors over 24 hours. ~100% error rate, sustained ~3.5 req/sec around the clock. I assumed the worker was broken. It wasn't.

Every unhandled path was falling through to my MCP transport, which expects JSON-RPC bodies. Bot scanners hitting `/wp-login.php`, `/.env`, `/.git`, `/admin`, `/phpmyadmin`, etc. were triggering 500s on every request because the SDK threw on a non-JSON-RPC body.

The fix was a path-and-UA filter that runs before any KV or D1 call:

```typescript
const BLOCKED_PATH_PATTERNS = [
  /^\/wp-/,
  /^\/wordpress/,
  /^\/admin/,
  /^\/phpmyadmin/,
  /^\/xmlrpc\.php/,
  /^\/\.env/,
  /^\/\.git/,
  /^\/\.aws/,
  /^\/\.ssh/,
  /^\/cgi-bin/,
  /\.php$/,
  /\.asp$/i,
  /\.aspx$/i,
  /\.jsp$/i,
  /^\/owa\//,
  /^\/ecp\//,
  /^\/_ignition/,
];

const BLOCKED_USER_AGENTS = [
  "masscan", "nmap", "sqlmap", "nikto", "gobuster",
  "metasploit", "hydra", "acunetix", "nessus",
  "zgrab", "shodan", "censys", "l9scan", "l9explore",
];

function isBotProbe(url: URL, ua: string): boolean {
  for (const p of BLOCKED_PATH_PATTERNS) {
    if (p.test(url.pathname)) return true;
  }
  if (ua) {
    const uaLower = ua.toLowerCase();
    for (const bad of BLOCKED_USER_AGENTS) {
      if (uaLower.includes(bad)) return true;
    }
  }
  return false;
}

// First line of the fetch handler:
if (isBotProbe(url, ua)) {
  return new Response("Gone", { status: 410 });
}
```

I returned **410 Gone** instead of 404 deliberately. RFC 9110: 410 means "permanently removed, don't retry." Well-behaved scanners (and crawlers respecting cache) stop coming back. Misbehaving ones still hit, but each request now exits in microseconds with no KV/D1/MCP-transport cost.

**Results 6 hours after deploy:**

- Requests: 323k (similar — bots still try)
- Errors: 27k, **down 87.03%**
- Median CPU time: 0.96ms, **down 17%**
- Error rate: 8.4% (down from ~100%)

The traffic volume didn't drop. The cost per bad request did.

A few things I didn't expect:

1. The `.workers.dev` URL was indexed and being scanned within hours of deployment, weeks before I told anyone it existed. Cloudflare's public Worker namespace is actively crawled.
2. `python-requests` showed up as a frequent UA. I left it off the blocklist because too many legit clients use the default UA, but it's tempting.
3. Some scanners ignore 410 and keep retrying. If those volumes stay high I'll add Cloudflare WAF rules at the zone level (free with Workers Paid).

Things I'd like to know:

1. Does anyone have a published list of bot-scanner UAs and paths that's actually maintained? Most of what I found online was 2018-era WordPress plugin lists.
2. Is there a clean way to detect "scanner" behavior heuristically (rate, path entropy) instead of pattern-matching? I'd rather block by behavior than by hardcoded list.
3. Has anyone measured whether 410 actually reduces retry traffic from major scanners vs 404 or 403?

(Posting from Namibia. Throwaway story, not a launch — just thought the numbers were interesting.)

---

## Why this version is good for Friday HN

- **No product name in the title or body.** Not a launch. Not a Show HN. Just an ops story.
- **Real numbers, before-and-after, single chart's worth of data.** HN's exact taste.
- **Code block readable in 30 seconds.** No deep dive needed.
- **Three honest open questions at the bottom.** HN rewards "I don't know X, do you?" disproportionately.
- **One sentence of personal context (Namibia) at the very end.** Not the lede.
- **No GitHub link, no live URL, no npm.** This protects your main launch. If someone in comments asks what the worker actually does, you reply with the link there. The post itself stays focused.

---

## Posting

Submit at: https://news.ycombinator.com/submit
- Title: `My Cloudflare Worker hit 309k errors/day from bot scanners. A 40-line filter dropped it 87% in 6 hours.`
- URL: leave blank
- Text: paste the body above

**Best Friday slot:** post around **15:00 CAT today (= 09:00 ET Friday)**. Friday HN engagement is lower overall but mornings still work. Posting later than 11:00 ET on a Friday is dead.

Right now in Grootfontein it's roughly mid-morning Friday. If you post in the next 2-3 hours you catch US East Coast waking up.

---

## What to do in the comment thread

- Reply within 30 minutes for the first 2 hours, then check every hour
- Don't link to FreshContext unless someone asks what the worker is for
- If asked, reply once: "It's an MCP server I'm working on, [github-link]. Not what this post is about, but happy to answer questions."
- Treat every UA suggestion or block-list addition as a gift — thank them, add it to your code that day, reply back with the commit
- Save the comment thread to `BOT_FILTER_FEEDBACK.md` afterward — that's your roadmap for hardening the filter further

---

## If it flops

It probably will. Most HN posts do. That's fine — the cost was 20 minutes of writing. The throwaway worked if:

- You learned the title-and-format taste of HN
- Got 1-2 comments worth replying to
- Didn't accidentally burn the Tuesday launch

The point of throwaways is to learn HN, not to win HN.

---

## What this leaves intact for Tuesday

- The full DAR engine reveal
- The 975-signals-scored numbers
- The methodology document
- The grand "exponential decay scoring for retrieved web data" framing
- The actual launch energy

Tuesday's post is still loaded. This Friday post just spends a little ammo on a different target.
