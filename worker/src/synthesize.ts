/**
 * synthesize.ts — Layer 4: Claude Intelligence Synthesis
 *
 * Reads new scrape results + user profile from D1,
 * calls Claude API, returns a structured morning briefing.
 */

export interface UserProfile {
  id: string;
  name: string | null;
  skills: string;
  certifications: string;
  targets: string;
  location: string | null;
  context: string | null;
}

export interface ScrapeResult {
  id: string;
  watched_query_id: string;
  adapter: string;
  query: string;
  raw_content: string;
  scraped_at: string;
}

export interface WatchedQuery {
  id: string;
  label: string | null;
  adapter: string;
  query: string;
}

export interface Briefing {
  summary: string;
  sections: BriefingSection[];
  generated_at: string;
  new_results_count: number;
}

export interface BriefingSection {
  adapter: string;
  label: string;
  highlights: string[];
  action_items: string[];
}

async function callClaudeAPI(prompt: string): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": (globalThis as any).__ANTHROPIC_KEY__ ?? "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude API error ${res.status}: ${err.slice(0, 200)}`);
  }

  const data = await res.json() as {
    content: Array<{ type: string; text: string }>;
  };

  return data.content
    .filter(b => b.type === "text")
    .map(b => b.text)
    .join("\n");
}

export async function synthesizeBriefing(
  db: D1Database,
  anthropicKey: string,
  userId = "default"
): Promise<Briefing | null> {

  // Inject key for callClaudeAPI
  (globalThis as any).__ANTHROPIC_KEY__ = anthropicKey;

  // 1. Load user profile
  const profile = await db.prepare(
    `SELECT * FROM user_profiles WHERE id = ?`
  ).first<UserProfile>(userId);

  if (!profile) return null;

  // 2. Load new scrape results since last briefing
  const { results: newResults } = await db.prepare(`
    SELECT sr.*, wq.label
    FROM scrape_results sr
    LEFT JOIN watched_queries wq ON sr.watched_query_id = wq.id
    WHERE sr.is_new = 1
    AND sr.scraped_at >= datetime('now', '-8 hours')
    ORDER BY sr.scraped_at DESC
    LIMIT 30
  `).all<ScrapeResult & { label: string | null }>();

  if (!newResults.length) return null;

  // 3. Group by adapter for structured prompt
  const grouped: Record<string, Array<ScrapeResult & { label: string | null }>> = {};
  for (const r of newResults) {
    if (!grouped[r.adapter]) grouped[r.adapter] = [];
    grouped[r.adapter].push(r);
  }

  // 4. Build prompt
  const profileSummary = [
    `Name: ${profile.name ?? "User"}`,
    `Location: ${profile.location ?? "Unknown"}`,
    `Skills: ${profile.skills}`,
    `Certifications: ${profile.certifications}`,
    `Targets: ${profile.targets}`,
    `Context: ${profile.context ?? ""}`,
  ].join("\n");

  const resultsSummary = Object.entries(grouped).map(([adapter, items]) => {
    const section = items.map(r =>
      `[${r.label ?? r.query}]\n${r.raw_content.slice(0, 600)}`
    ).join("\n---\n");
    return `## ${adapter.toUpperCase()} (${items.length} new)\n${section}`;
  }).join("\n\n");

  const prompt = `You are an intelligent personal briefing assistant. 
  
The user's profile:
${profileSummary}

New intelligence gathered in the last 8 hours:
${resultsSummary}

Generate a concise morning briefing in this exact JSON format (no markdown, no preamble, raw JSON only):
{
  "summary": "2-3 sentence overall summary of what's new and most relevant",
  "sections": [
    {
      "adapter": "adapter_name",
      "label": "Human readable section title",
      "highlights": ["key finding 1", "key finding 2"],
      "action_items": ["specific action to take", "another action"]
    }
  ]
}

Focus on:
- Job opportunities that match the user's skills and targets
- New repos or tools relevant to their tech stack
- Market signals or ecosystem changes
- Be direct, specific, actionable
- Score relevance against their profile — skip generic noise`;

  // 5. Call Claude
  const raw = await callClaudeAPI(prompt);

  // 6. Parse response
  let parsed: { summary: string; sections: BriefingSection[] };
  try {
    const cleaned = raw.replace(/```json|```/g, "").trim();
    parsed = JSON.parse(cleaned);
  } catch {
    // If parsing fails, wrap raw text as a single section
    parsed = {
      summary: raw.slice(0, 300),
      sections: [],
    };
  }

  const briefing: Briefing = {
    summary: parsed.summary,
    sections: parsed.sections ?? [],
    generated_at: new Date().toISOString(),
    new_results_count: newResults.length,
  };

  // 7. Persist briefing to D1
  const briefingId = `br_${Date.now()}`;
  const adaptersRun = Object.keys(grouped);
  await db.prepare(`
    INSERT INTO briefings (id, user_id, summary, new_results_count, adapters_run, created_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
  `).bind(
    briefingId,
    userId,
    briefing.summary,
    briefing.new_results_count,
    JSON.stringify(adaptersRun)
  ).run();

  // 8. Mark results as no longer new (avoid re-briefing)
  await db.prepare(`
    UPDATE scrape_results SET is_new = 0
    WHERE is_new = 1
    AND scraped_at >= datetime('now', '-8 hours')
  `).run();

  return briefing;
}
