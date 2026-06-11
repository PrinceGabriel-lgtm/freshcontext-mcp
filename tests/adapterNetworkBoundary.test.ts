import test from "node:test";
import assert from "node:assert/strict";
import { changelogAdapter } from "../src/adapters/changelog.js";
import { redditAdapter } from "../src/adapters/reddit.js";

function installFetch(handler: (input: string | URL | Request) => Response): () => void {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: string | URL | Request) => handler(input);
  return () => {
    globalThis.fetch = originalFetch;
  };
}

test("reddit adapter rejects private and non-Reddit direct URLs before fetch", async () => {
  const requested: string[] = [];
  const restore = installFetch((input) => {
    requested.push(String(input));
    return new Response("{}", { status: 200 });
  });

  try {
    await assert.rejects(
      redditAdapter({ url: "http://127.0.0.1:8787/search.json?q=test" }),
      /Access to internal\/private addresses is not permitted/
    );
    await assert.rejects(
      redditAdapter({ url: "https://example.com/search.json?q=test" }),
      /Domain not allowed for reddit adapter/
    );
    assert.equal(requested.length, 0);
  } finally {
    restore();
  }
});

test("reddit adapter still turns plain search text into a Reddit JSON API request", async () => {
  const requested: string[] = [];
  const restore = installFetch((input) => {
    requested.push(String(input));
    return new Response(JSON.stringify({
      data: {
        children: [
          {
            data: {
              title: "FreshContext discussion",
              url: "https://example.com/post",
              permalink: "/r/artificial/comments/abc/freshcontext_discussion/",
              score: 42,
              num_comments: 7,
              author: "sample_user",
              created_utc: 1770000000,
              selftext: "",
              subreddit: "artificial",
              is_self: false,
            },
          },
        ],
      },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  });

  try {
    const result = await redditAdapter({ url: "freshcontext context judgment", maxLength: 1000 });
    assert.match(requested[0], /^https:\/\/www\.reddit\.com\/search\.json\?/);
    assert.match(result.raw, /FreshContext discussion/);
    assert.equal(result.freshness_confidence, "high");
  } finally {
    restore();
  }
});

test("changelog adapter rejects private direct URLs before fetch or browser discovery", async () => {
  const requested: string[] = [];
  const restore = installFetch((input) => {
    requested.push(String(input));
    return new Response("{}", { status: 200 });
  });

  try {
    await assert.rejects(
      changelogAdapter({ url: "http://169.254.169.254/latest/meta-data" }),
      /Access to internal\/private addresses is not permitted/
    );
    assert.equal(requested.length, 0);
  } finally {
    restore();
  }
});

test("changelog npm package path remains available", async () => {
  const requested: string[] = [];
  const restore = installFetch((input) => {
    requested.push(String(input));
    return new Response(JSON.stringify({
      name: "freshcontext-mcp",
      description: "sample package",
      time: {
        created: "2026-01-01T00:00:00.000Z",
        modified: "2026-06-01T00:00:00.000Z",
        "0.3.19": "2026-06-01T00:00:00.000Z",
      },
      versions: { "0.3.19": { version: "0.3.19" } },
      "dist-tags": { latest: "0.3.19" },
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  });

  try {
    const result = await changelogAdapter({ url: "freshcontext-mcp", maxLength: 1000 });
    assert.equal(requested[0], "https://registry.npmjs.org/freshcontext-mcp");
    assert.match(result.raw, /Package: freshcontext-mcp/);
    assert.equal(result.content_date, "2026-06-01T00:00:00.000Z");
  } finally {
    restore();
  }
});
