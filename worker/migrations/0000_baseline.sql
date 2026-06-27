-- BASELINE — documents schema already live as of 2026-06-27.
-- Do NOT re-run against prod; recorded for tracking and disaster-recovery only.
--
-- Source: SELECT name, sql FROM sqlite_master WHERE type='table' ORDER BY name
-- run against freshcontext-db (d9898d65-f67e-4dcb-abdc-7f7b53f2d444) on 2026-06-27.
-- Verbatim column definitions from sqlite_master; only change is CREATE TABLE → CREATE TABLE IF NOT EXISTS.
-- _cf_KV excluded (Cloudflare system table, not user-managed).

CREATE TABLE IF NOT EXISTS briefings (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'default',
  summary TEXT NOT NULL,
  new_results_count INTEGER NOT NULL DEFAULT 0,
  adapters_run TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Note: columns from relevancy_score through is_expired appear inline on one row in
-- sqlite_master because they were added via ALTER TABLE after initial creation.
-- This is the verbatim storage format SQLite produces for that history.
CREATE TABLE IF NOT EXISTS scrape_results (
  id TEXT PRIMARY KEY,
  watched_query_id TEXT NOT NULL,
  adapter TEXT NOT NULL,
  query TEXT NOT NULL,
  raw_content TEXT NOT NULL,
  result_hash TEXT NOT NULL,
  is_new INTEGER NOT NULL DEFAULT 1,
  scraped_at TEXT NOT NULL DEFAULT (datetime('now')), relevancy_score INTEGER DEFAULT 0, is_relevant INTEGER DEFAULT 1, base_score INTEGER DEFAULT 0, rt_score REAL DEFAULT 0, ha_pri_sig TEXT, entropy_level TEXT DEFAULT 'stable', published_at TEXT, semantic_fingerprint TEXT, is_expired INTEGER DEFAULT 0,
  FOREIGN KEY (watched_query_id) REFERENCES watched_queries(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_profiles (
  id TEXT PRIMARY KEY DEFAULT 'default',
  name TEXT,
  skills TEXT NOT NULL DEFAULT '[]',
  certifications TEXT NOT NULL DEFAULT '[]',
  targets TEXT NOT NULL DEFAULT '[]',
  location TEXT,
  context TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS watched_queries (
  id TEXT PRIMARY KEY,
  adapter TEXT NOT NULL,
  query TEXT NOT NULL,
  filters TEXT NOT NULL DEFAULT '{}',
  user_id TEXT NOT NULL DEFAULT 'default',
  label TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  last_run_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
