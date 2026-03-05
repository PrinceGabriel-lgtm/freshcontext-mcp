import { AdapterResult, ExtractOptions } from "../types.js";

/**
 * Jobs adapter — two sources, pure fetch, no auth required.
 *
 * Source 1: Remotive API (structured remote jobs, publication_date on every listing)
 *   https://remotive.com/api/remote-jobs?search=QUERY&limit=10
 *
 * Source 2: HN "Who is Hiring" comments (community-sourced, timestamped)
 *   Searches Algolia for relevant comments in hiring threads
 *
 * This adapter was the whole reason freshcontext exists.
 * Claude kept returning job listings from 2022. This fixes that.
 */
export async function jobsAdapter(options: ExtractOptions): Promise<AdapterResult> {
  const query = options.url.trim();
  const maxLength = options.maxLength ?? 6000;
  const perSource = Math.floor(maxLength / 2);

  const [remotiveResult, hnResult] = await Promise.allSettled([
    fetchRemotive(query, perSource),
    fetchHNHiring(query, perSource),
  ]);

  const sections: string[] = [];
  let newestDate: string | null = null;

  const trackDate = (d: string | null) => {
    if (d && (!newestDate || d > newestDate)) newestDate = d;
  };

  // ── Remotive ──────────────────────────────────────────────────────────────
  if (remotiveResult.status === "fulfilled" && remotiveResult.value.raw) {
    sections.push(`## 🌐 Remote Jobs (Remotive)\n${remotiveResult.value.raw}`);
    trackDate(remotiveResult.value.content_date);
  } else if (remotiveResult.status === "rejected") {
    sections.push(`## 🌐 Remote Jobs (Remotive)\n[Unavailable: ${remotiveResult.reason}]`);
  }

  // ── HN Who is Hiring ──────────────────────────────────────────────────────
  if (hnResult.status === "fulfilled" && hnResult.value.raw) {
    sections.push(`## 💬 HN "Who is Hiring" (Community)\n${hnResult.value.raw}`);
    trackDate(hnResult.value.content_date);
  } else if (hnResult.status === "rejected") {
    sections.push(`## 💬 HN "Who is Hiring"\n[Unavailable: ${hnResult.reason}]`);
  }

  if (!sections.length) {
    return {
      raw: `No job results found for "${query}". Try broader terms like "typescript", "remote python", or "senior engineer".`,
      content_date: null,
      freshness_confidence: "low",
    };
  }

  const raw = [
    `# Job Search: "${query}"`,
    `⚠️  Every listing below includes its publication date. Check it before you apply.`,
    "",
    ...sections,
  ].join("\n\n");

  return {
    raw: raw.slice(0, maxLength),
    content_date: newestDate,
    freshness_confidence: newestDate ? "high" : "medium",
  };
}

// ─── Remotive ─────────────────────────────────────────────────────────────────

async function fetchRemotive(query: string, maxLength: number): Promise<AdapterResult> {
  const url = `https://remotive.com/api/remote-jobs?search=${encodeURIComponent(query)}&limit=10`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": "freshcontext-mcp/0.1.9 (https://github.com/PrinceGabriel-lgtm/freshcontext-mcp)",
      "Accept": "application/json",
    },
  });

  if (!res.ok) throw new Error(`Remotive API error: ${res.status}`);

  const data = await res.json() as {
    jobs: Array<{
      id: number;
      url: string;
      title: string;
      company_name: string;
      job_type: string;
      publication_date: string;
      candidate_required_location: string;
      salary: string;
      tags: string[];
    }>;
  };

  if (!data.jobs?.length) {
    return { raw: `No remote listings found for "${query}".`, content_date: null, freshness_confidence: "medium" };
  }

  const listings = data.jobs.map((job, i) => {
    const lines = [
      `[${i + 1}] ${job.title} — ${job.company_name}`,
      `Type: ${job.job_type || "N/A"} | Location: ${job.candidate_required_location || "Remote"}`,
      `Posted: ${job.publication_date}`,
      job.salary ? `Salary: ${job.salary}` : null,
      job.tags?.length ? `Tags: ${job.tags.slice(0, 5).join(", ")}` : null,
      `Apply: ${job.url}`,
    ].filter(Boolean).join("\n");
    return lines;
  });

  const raw = listings.join("\n\n").slice(0, maxLength);

  const dates = data.jobs
    .map(j => j.publication_date)
    .filter(Boolean)
    .sort()
    .reverse();

  return {
    raw,
    content_date: dates[0] ?? null,
    freshness_confidence: dates[0] ? "high" : "medium",
  };
}

// ─── HN Who is Hiring ─────────────────────────────────────────────────────────

async function fetchHNHiring(query: string, maxLength: number): Promise<AdapterResult> {
  const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query + " hiring")}&tags=comment&hitsPerPage=8`;

  const res = await fetch(url, {
    headers: { "User-Agent": "freshcontext-mcp/0.1.9" },
  });

  if (!res.ok) throw new Error(`HN Algolia error: ${res.status}`);

  const data = await res.json() as {
    hits: Array<{
      objectID: string;
      comment_text: string;
      author: string;
      created_at: string;
      parent_id: number;
      story_title: string | null;
    }>;
  };

  const jobHits = data.hits.filter(h => {
    const t = (h.comment_text ?? "").toLowerCase();
    return (
      t.includes("hiring") ||
      t.includes("remote") ||
      t.includes("full-time") ||
      t.includes("salary") ||
      t.includes("apply")
    );
  });

  if (!jobHits.length) {
    return { raw: `No HN hiring comments found for "${query}".`, content_date: null, freshness_confidence: "medium" };
  }

  const listings = jobHits.map((hit, i) => {
    const text = (hit.comment_text ?? "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 300);

    return [
      `[${i + 1}] Posted by ${hit.author} on ${hit.created_at.slice(0, 10)}`,
      text + (text.length >= 300 ? "…" : ""),
      `Source: https://news.ycombinator.com/item?id=${hit.objectID}`,
    ].join("\n");
  });

  const raw = listings.join("\n\n").slice(0, maxLength);
  const dates = jobHits.map(h => h.created_at).sort().reverse();

  return {
    raw,
    content_date: dates[0]?.slice(0, 10) ?? null,
    freshness_confidence: dates[0] ? "high" : "medium",
  };
}
