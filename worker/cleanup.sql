-- Remove old watched queries from previous session
DELETE FROM watched_queries WHERE id IN ('wq_001','wq_002','wq_003','wq_004','wq_005','wq_006','wq_007');

-- Confirm what remains
SELECT id, adapter, label FROM watched_queries ORDER BY created_at ASC;
