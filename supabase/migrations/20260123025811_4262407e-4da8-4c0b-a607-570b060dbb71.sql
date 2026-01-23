-- Delete recently imported "Homeowner" contacts from West Coast location (bad import)
-- These were all imported at 2026-01-23 02:27:06 with missing names

DELETE FROM contacts 
WHERE first_name = 'Homeowner'
  AND last_name = '' OR last_name IS NULL
  AND created_at >= '2026-01-23 02:27:00'
  AND created_at <= '2026-01-23 02:28:00';