-- Fix job queries to use terms Remotive actually has listings for
UPDATE watched_queries SET query = 'software engineer remote' WHERE id = 'wq_job_ts_mcp';
UPDATE watched_queries SET query = 'backend developer remote' WHERE id = 'wq_job_cf';
UPDATE watched_queries SET query = 'ai engineer remote' WHERE id = 'wq_job_ai_tool';
UPDATE watched_queries SET query = 'full stack developer remote' WHERE id = 'wq_job_devinfra';
-- Reset last_run_at so they run fresh next cycle
UPDATE watched_queries SET last_run_at = NULL WHERE adapter = 'jobs';
