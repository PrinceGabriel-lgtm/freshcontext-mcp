import test from "node:test";
import assert from "node:assert/strict";
import { arxivAdapter, searchArxivSignals } from "../src/adapters/arxiv.js";

const ARXIV_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2605.12345v1</id>
    <updated>2026-05-12T13:45:00Z</updated>
    <published>2026-05-10T09:30:00Z</published>
    <title>FreshContext temporal retrieval benchmark</title>
    <summary>
      A paper about freshness-ranked context selection for agent systems.
    </summary>
    <author><name>Ada Lovelace</name></author>
    <author><name>Grace Hopper</name></author>
    <arxiv:primary_category xmlns:arxiv="http://arxiv.org/schemas/atom" term="cs.AI" />
  </entry>
  <entry>
    <id>http://arxiv.org/abs/2501.99999v2</id>
    <updated>2025-02-01T00:00:00Z</updated>
    <published>2025-01-15T00:00:00Z</published>
    <title>Context aging in retrieval systems</title>
    <summary>Older but relevant retrieval context work.</summary>
    <author><name>Alan Turing</name></author>
    <category term="cs.IR" />
  </entry>
</feed>`;

const EMPTY_ARXIV_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>arXiv Query: no results</title>
</feed>`;

function installFetch(response: Response, urls: string[] = []): () => void {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input: string | URL | Request) => {
    urls.push(String(input));
    return response.clone();
  };

  return () => {
    globalThis.fetch = originalFetch;
  };
}

test("searchArxivSignals maps arXiv XML entries to FreshContextSignalInput", async () => {
  const requestedUrls: string[] = [];
  const restoreFetch = installFetch(new Response(ARXIV_FIXTURE, { status: 200 }), requestedUrls);

  try {
    const signals = await searchArxivSignals({
      query: "temporal retrieval",
      retrievedAt: "2026-06-02T10:00:00.000Z",
      semanticScore: 0.93,
    });

    assert.equal(requestedUrls.length, 1);
    assert.match(requestedUrls[0], /^https:\/\/export\.arxiv\.org\/api\/query\?/);
    assert.match(requestedUrls[0], /search_query=all:temporal%20retrieval/);
    assert.equal(signals.length, 2);

    assert.equal(signals[0].title, "FreshContext temporal retrieval benchmark");
    assert.equal(signals[0].content, "A paper about freshness-ranked context selection for agent systems.");
    assert.equal(signals[0].source, "https://arxiv.org/abs/2605.12345v1");
    assert.equal(signals[0].source_type, "arxiv");
    assert.equal(signals[0].published_at, "2026-05-10T09:30:00Z");
    assert.equal(signals[0].retrieved_at, "2026-06-02T10:00:00.000Z");
    assert.equal(signals[0].semantic_score, 0.93);
    assert.deepEqual(signals[0].metadata?.authors, ["Ada Lovelace", "Grace Hopper"]);
    assert.equal(signals[0].metadata?.category, "cs.AI");
    assert.equal(signals[0].metadata?.updated_at, "2026-05-12T13:45:00Z");
    assert.equal(signals[0].metadata?.query, "temporal retrieval");

    assert.equal(signals[1].source, "https://arxiv.org/abs/2501.99999v2");
    assert.equal(signals[1].metadata?.category, "cs.IR");
  } finally {
    restoreFetch();
  }
});

test("searchArxivSignals respects direct API URLs, retrievedAt, semanticScore, and maxResults", async () => {
  const requestedUrls: string[] = [];
  const restoreFetch = installFetch(new Response(ARXIV_FIXTURE, { status: 200 }), requestedUrls);

  try {
    const signals = await searchArxivSignals({
      query: "https://export.arxiv.org/api/query?search_query=all:test",
      maxResults: 3,
      retrievedAt: "2026-06-02T11:00:00.000Z",
      semanticScore: 0.67,
    });

    assert.equal(requestedUrls[0], "https://export.arxiv.org/api/query?search_query=all:test");
    assert.equal(signals[0].retrieved_at, "2026-06-02T11:00:00.000Z");
    assert.equal(signals[0].semantic_score, 0.67);
  } finally {
    restoreFetch();
  }
});

test("searchArxivSignals rejects non-arXiv direct URLs before fetch", async () => {
  const requestedUrls: string[] = [];
  const restoreFetch = installFetch(new Response(ARXIV_FIXTURE, { status: 200 }), requestedUrls);

  try {
    await assert.rejects(
      searchArxivSignals({ query: "http://127.0.0.1:8787/internal" }),
      /Access to internal\/private addresses is not permitted/
    );
    await assert.rejects(
      searchArxivSignals({ query: "https://example.com/api/query?search_query=all:test" }),
      /Domain not allowed for arxiv adapter/
    );
    assert.equal(requestedUrls.length, 0);
  } finally {
    restoreFetch();
  }
});

test("searchArxivSignals defaults retrieved_at and semantic_score for signal output", async () => {
  const restoreFetch = installFetch(new Response(ARXIV_FIXTURE, { status: 200 }));

  try {
    const before = Date.now();
    const signals = await searchArxivSignals({ query: "context freshness" });
    const after = Date.now();

    assert.equal(signals[0].semantic_score, 0.8);
    assert.ok(signals[0].retrieved_at);

    const retrievedAt = Date.parse(signals[0].retrieved_at ?? "");
    assert.ok(retrievedAt >= before - 1000);
    assert.ok(retrievedAt <= after + 1000);
  } finally {
    restoreFetch();
  }
});

test("searchArxivSignals returns an empty signal list for no-results XML", async () => {
  const restoreFetch = installFetch(new Response(EMPTY_ARXIV_FIXTURE, { status: 200 }));

  try {
    const signals = await searchArxivSignals({ query: "freshcontext no result fixture" });
    assert.deepEqual(signals, []);
  } finally {
    restoreFetch();
  }
});

test("searchArxivSignals rejects predictably on arXiv API failure", async () => {
  const restoreFetch = installFetch(new Response("too many requests", {
    status: 429,
    statusText: "Too Many Requests",
  }));

  try {
    await assert.rejects(
      searchArxivSignals({ query: "rate limited" }),
      /arXiv API error: 429 Too Many Requests/,
    );
  } finally {
    restoreFetch();
  }
});

test("arxivAdapter still returns aggregate AdapterResult shape from the same fixture", async () => {
  const restoreFetch = installFetch(new Response(ARXIV_FIXTURE, { status: 200 }));

  try {
    const result = await arxivAdapter({ url: "temporal retrieval", maxLength: 6000 });

    assert.match(result.raw, /\[1\] FreshContext temporal retrieval benchmark/);
    assert.match(result.raw, /Authors: Ada Lovelace, Grace Hopper/);
    assert.match(result.raw, /Published: 2026-05-10 \(updated 2026-05-12\)/);
    assert.match(result.raw, /Category: cs.AI/);
    assert.match(result.raw, /Link: https:\/\/arxiv\.org\/abs\/2605\.12345v1/);
    assert.equal(result.content_date, "2026-05-10");
    assert.equal(result.freshness_confidence, "high");
  } finally {
    restoreFetch();
  }
});

test("arxivAdapter keeps no-results AdapterResult behavior", async () => {
  const restoreFetch = installFetch(new Response(EMPTY_ARXIV_FIXTURE, { status: 200 }));

  try {
    const result = await arxivAdapter({ url: "no results" });

    assert.equal(result.raw, "No results found for this query.");
    assert.equal(result.content_date, null);
    assert.equal(result.freshness_confidence, "low");
  } finally {
    restoreFetch();
  }
});
