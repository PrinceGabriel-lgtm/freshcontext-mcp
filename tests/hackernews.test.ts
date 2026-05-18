import test from "node:test";
import assert from "node:assert/strict";
import { hackerNewsAdapter } from "../src/adapters/hackernews.js";
import { stampFreshness, formatForLLM } from "../src/tools/freshnessStamp.js";

function parseFreshContextJson(text: string): {
  freshcontext: {
    source_url: string;
    content_date: string | null;
    retrieved_at: string;
    freshness_confidence: "high" | "medium" | "low";
    freshness_score: number | null;
    adapter: string;
  };
  content: string;
} {
  const match = text.match(/\[FRESHCONTEXT_JSON\]\s*([\s\S]*?)\s*\[\/FRESHCONTEXT_JSON\]/);
  assert.ok(match, "Missing [FRESHCONTEXT_JSON] block");
  return JSON.parse(match[1]);
}

test("plain text Hacker News query path remains accepted and uses Algolia search", async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls: string[] = [];

  globalThis.fetch = async (input: string | URL | Request) => {
    const url = String(input);
    requestedUrls.push(url);

    return new Response(JSON.stringify({
      hits: [
        {
          title: "Browser agents are getting useful",
          url: "https://example.com/browser-agents",
          points: 42,
          num_comments: 12,
          author: "pg",
          created_at: "2026-05-13T10:00:00.000Z",
          objectID: "123",
        },
      ],
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  try {
    const result = await hackerNewsAdapter({ url: "browser agents", maxLength: 4000 });

    assert.equal(requestedUrls.length, 1);
    assert.match(requestedUrls[0], /^https:\/\/hn\.algolia\.com\/api\/v1\/search\?/);
    assert.match(requestedUrls[0], /query=browser%20agents/);
    assert.match(result.raw, /Browser agents are getting useful/);
    assert.equal(result.content_date, "2026-05-13T10:00:00.000Z");
    assert.equal(result.freshness_confidence, "high");
    assert.doesNotThrow(() => new Date(result.content_date ?? "").toISOString());
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Hacker News stamped output remains FreshContext-compatible", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () => new Response(JSON.stringify({
    hits: [
      {
        title: "FreshContext Core extraction",
        url: null,
        points: 17,
        num_comments: 5,
        author: "hn_user",
        created_at: "2026-05-13T09:30:00Z",
        objectID: "456",
      },
    ],
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });

  try {
    const result = await hackerNewsAdapter({ url: "freshcontext core", maxLength: 4000 });
    const ctx = stampFreshness(result, { url: "freshcontext core", maxLength: 4000 }, "hackernews");
    const text = formatForLLM(ctx);
    const parsed = parseFreshContextJson(text);

    assert.match(text, /\[FRESHCONTEXT\]/);
    assert.match(text, /Source: freshcontext core/);
    assert.match(text, /Published: 2026-05-13T09:30:00.000Z/);
    assert.match(text, /Retrieved:/);
    assert.match(text, /Confidence: high/);
    assert.equal(parsed.freshcontext.source_url, "freshcontext core");
    assert.equal(parsed.freshcontext.content_date, "2026-05-13T09:30:00.000Z");
    assert.equal(parsed.freshcontext.freshness_confidence, "high");
    assert.equal(parsed.freshcontext.adapter, "hackernews");
    assert.equal(typeof parsed.freshcontext.freshness_score, "number");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
