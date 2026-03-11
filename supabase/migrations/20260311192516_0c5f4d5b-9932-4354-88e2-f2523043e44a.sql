-- Temporarily disable the protection trigger
ALTER TABLE pipeline_entries DISABLE TRIGGER guard_converted_pipeline_delete;

-- Step 1: Nullify project links from duplicate pipeline entries
WITH duplicates AS (
  SELECT id, contact_id,
    ROW_NUMBER() OVER (PARTITION BY contact_id ORDER BY created_at ASC) as rn
  FROM pipeline_entries
  WHERE is_deleted = false
  AND contact_id IN (
    SELECT contact_id FROM pipeline_entries WHERE is_deleted = false
    GROUP BY contact_id HAVING COUNT(*) > 1
  )
),
remove_entries AS (
  SELECT id as remove_id FROM duplicates WHERE rn > 1
)
UPDATE projects p
SET pipeline_entry_id = NULL
FROM remove_entries r
WHERE p.pipeline_entry_id = r.remove_id;

-- Step 2: Unlink agreement_instances
WITH duplicates AS (
  SELECT id, contact_id,
    ROW_NUMBER() OVER (PARTITION BY contact_id ORDER BY created_at ASC) as rn
  FROM pipeline_entries
  WHERE is_deleted = false
  AND contact_id IN (
    SELECT contact_id FROM pipeline_entries WHERE is_deleted = false
    GROUP BY contact_id HAVING COUNT(*) > 1
  )
),
remove_entries AS (
  SELECT id as remove_id FROM duplicates WHERE rn > 1
)
UPDATE agreement_instances ai
SET pipeline_entry_id = NULL
FROM remove_entries r
WHERE ai.pipeline_entry_id = r.remove_id;

-- Step 3: Soft-delete the duplicate entries
UPDATE pipeline_entries
SET is_deleted = true, updated_at = now()
WHERE id IN (
  SELECT id FROM (
    SELECT id, contact_id,
      ROW_NUMBER() OVER (PARTITION BY contact_id ORDER BY created_at ASC) as rn
    FROM pipeline_entries
    WHERE is_deleted = false
    AND contact_id IN (
      SELECT contact_id FROM pipeline_entries WHERE is_deleted = false
      GROUP BY contact_id HAVING COUNT(*) > 1
    )
  ) ranked
  WHERE rn > 1
);

-- Re-enable the trigger
ALTER TABLE pipeline_entries ENABLE TRIGGER guard_converted_pipeline_delete;

-- Step 4: Create the unique index
CREATE UNIQUE INDEX idx_one_active_lead_per_contact
ON public.pipeline_entries (contact_id)
WHERE is_deleted = false;