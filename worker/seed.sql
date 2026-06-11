-- ============================================================
-- FRESHCONTEXT D1 SEED - sample end-to-end intelligence setup
-- Demo data only. Replace the profile and watched queries before production use.
-- ============================================================

-- ── USER PROFILE ─────────────────────────────────────────────
INSERT OR REPLACE INTO user_profiles (id, name, skills, certifications, targets, location, context)
VALUES (
  'default',
  'Sample Analyst',
  '["TypeScript","Cloudflare Workers","MCP servers","Node.js","D1 SQLite","REST APIs","AI integration","Wrangler CLI"]',
  '["Cloudflare Developer","MCP Builder","AI Tooling"]',
  '["AI tooling companies","MCP ecosystem","developer infrastructure","Cloudflare ecosystem","developer tools startups"]',
  'Remote',
  'Sample profile for validating FreshContext watched-query ingestion and briefing output. Replace this with project-specific context before production use.'
);


-- ── WATCHED QUERIES — JOBS ───────────────────────────────────
INSERT OR REPLACE INTO watched_queries (id, adapter, query, label, user_id, enabled) VALUES
  ('wq_job_ts_mcp',   'jobs', 'typescript mcp server developer remote',  'Jobs: TypeScript MCP',      'default', 1);
INSERT OR REPLACE INTO watched_queries (id, adapter, query, label, user_id, enabled) VALUES
  ('wq_job_cf',       'jobs', 'cloudflare workers developer remote',      'Jobs: Cloudflare Workers',  'default', 1);
INSERT OR REPLACE INTO watched_queries (id, adapter, query, label, user_id, enabled) VALUES
  ('wq_job_ai_tool',  'jobs', 'ai tooling developer remote',              'Jobs: AI Tooling',          'default', 1);
INSERT OR REPLACE INTO watched_queries (id, adapter, query, label, user_id, enabled) VALUES
  ('wq_job_devinfra', 'jobs', 'developer infrastructure typescript',      'Jobs: Dev Infrastructure',  'default', 1);

-- ── WATCHED QUERIES — GITHUB ─────────────────────────────────
INSERT OR REPLACE INTO watched_queries (id, adapter, query, label, user_id, enabled) VALUES
  ('wq_gh_mcp',    'github', 'https://github.com/modelcontextprotocol/servers', 'GitHub: MCP Servers Repo',      'default', 1);
INSERT OR REPLACE INTO watched_queries (id, adapter, query, label, user_id, enabled) VALUES
  ('wq_gh_cf_ai',  'github', 'https://github.com/cloudflare/workers-ai',        'GitHub: Cloudflare Workers AI', 'default', 1);
INSERT OR REPLACE INTO watched_queries (id, adapter, query, label, user_id, enabled) VALUES
  ('wq_gh_fc',     'github', 'https://github.com/PrinceGabriel-lgtm/freshcontext-mcp', 'GitHub: FreshContext Repo', 'default', 1);

-- ── WATCHED QUERIES — HACKER NEWS ────────────────────────────
INSERT OR REPLACE INTO watched_queries (id, adapter, query, label, user_id, enabled) VALUES
  ('wq_hn_mcp',    'hackernews', 'mcp server 2026',           'HN: MCP Servers',      'default', 1);
INSERT OR REPLACE INTO watched_queries (id, adapter, query, label, user_id, enabled) VALUES
  ('wq_hn_cf',     'hackernews', 'cloudflare workers ai',     'HN: Cloudflare AI',    'default', 1);
INSERT OR REPLACE INTO watched_queries (id, adapter, query, label, user_id, enabled) VALUES
  ('wq_hn_hiring', 'hackernews', 'who is hiring typescript',  'HN: Who Is Hiring TS', 'default', 1);


-- ── WATCHED QUERIES — REDDIT ─────────────────────────────────
INSERT OR REPLACE INTO watched_queries (id, adapter, query, label, user_id, enabled) VALUES
  ('wq_rd_mcp',      'reddit', 'r/MachineLearning mcp',       'Reddit: r/ML MCP',    'default', 1);
INSERT OR REPLACE INTO watched_queries (id, adapter, query, label, user_id, enabled) VALUES
  ('wq_rd_devtools', 'reddit', 'r/webdev developer tools ai', 'Reddit: r/webdev AI', 'default', 1);

-- ── WATCHED QUERIES — REPO SEARCH ────────────────────────────
INSERT OR REPLACE INTO watched_queries (id, adapter, query, label, user_id, enabled) VALUES
  ('wq_rs_mcp',   'reposearch', 'mcp server typescript',             'Repos: MCP TypeScript',    'default', 1);
INSERT OR REPLACE INTO watched_queries (id, adapter, query, label, user_id, enabled) VALUES
  ('wq_rs_fresh', 'reposearch', 'web intelligence freshness ai',     'Repos: Web Intelligence',  'default', 1);

-- ── WATCHED QUERIES — YC ─────────────────────────────────────
INSERT OR REPLACE INTO watched_queries (id, adapter, query, label, user_id, enabled) VALUES
  ('wq_yc_ai',    'yc', 'ai developer tools',        'YC: AI Dev Tools',       'default', 1);
INSERT OR REPLACE INTO watched_queries (id, adapter, query, label, user_id, enabled) VALUES
  ('wq_yc_infra', 'yc', 'developer infrastructure',  'YC: Dev Infrastructure', 'default', 1);

-- ── WATCHED QUERIES — PACKAGE TRENDS ─────────────────────────
INSERT OR REPLACE INTO watched_queries (id, adapter, query, label, user_id, enabled) VALUES
  ('wq_pkg_mcp',      'packagetrends', 'mcp',      'npm: MCP package', 'default', 1);
INSERT OR REPLACE INTO watched_queries (id, adapter, query, label, user_id, enabled) VALUES
  ('wq_pkg_wrangler', 'packagetrends', 'wrangler', 'npm: Wrangler',    'default', 1);
