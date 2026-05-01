-- Update job queries to match what Remotive actually has live
UPDATE watched_queries SET query = 'developer' WHERE id = 'wq_job_ts_mcp';
UPDATE watched_queries SET query = 'engineer' WHERE id = 'wq_job_cf';
UPDATE watched_queries SET query = 'ai engineer' WHERE id = 'wq_job_ai_tool';
UPDATE watched_queries SET query = 'backend' WHERE id = 'wq_job_devinfra';
-- Reset all last_run_at so everything runs fresh next cycle
UPDATE watched_queries SET last_run_at = NULL WHERE adapter = 'jobs';
