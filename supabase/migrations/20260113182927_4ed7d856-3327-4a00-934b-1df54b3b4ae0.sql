-- Backfill password_set_at for all existing profiles where it's NULL
-- These are legacy accounts that existed before this field was added
UPDATE profiles
SET password_set_at = COALESCE(created_at, NOW())
WHERE password_set_at IS NULL;