
-- =============================================
-- STEP 1: Drop auto-lead creation triggers
-- =============================================
DROP TRIGGER IF EXISTS sync_new_contact_to_pipeline ON contacts;
DROP TRIGGER IF EXISTS sync_contact_to_pipeline ON contacts;

-- =============================================
-- STEP 2: Create normalize_street function
-- =============================================
CREATE OR REPLACE FUNCTION normalize_street(street text)
RETURNS text AS $$
BEGIN
  RETURN lower(trim(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(
                regexp_replace(
                  regexp_replace(
                    regexp_replace(
                      regexp_replace(
                        regexp_replace(
                          regexp_replace(street,
                            '\y(drive)\y', 'dr', 'gi'),
                          '\y(street)\y', 'st', 'gi'),
                        '\y(avenue)\y', 'ave', 'gi'),
                      '\y(boulevard)\y', 'blvd', 'gi'),
                    '\y(court)\y', 'ct', 'gi'),
                  '\y(place)\y', 'pl', 'gi'),
                '\y(lane)\y', 'ln', 'gi'),
              '\y(road)\y', 'rd', 'gi'),
            '\y(circle)\y', 'cir', 'gi'),
          '\y(parkway)\y', 'pkwy', 'gi'),
        '\y(terrace)\y', 'ter', 'gi'),
      '\y(highway)\y', 'hwy', 'gi')
  ));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- =============================================
-- STEP 3: Merge known duplicates
-- =============================================
-- jean louis: keep adf03d46, remove 65a9547f
UPDATE pipeline_entries SET contact_id = 'adf03d46-2ada-4aa5-9867-aa328256081b' WHERE contact_id = '65a9547f-0d5b-400f-aad3-4a905103cddc';
DELETE FROM contacts WHERE id = '65a9547f-0d5b-400f-aad3-4a905103cddc';

-- tariq alinur: keep e9ef2c4f, remove b4bdfb88
UPDATE pipeline_entries SET contact_id = 'e9ef2c4f-6f57-4a9d-94c1-da0b722799b9' WHERE contact_id = 'b4bdfb88-69b9-4744-9c19-da6e774add67';
DELETE FROM contacts WHERE id = 'b4bdfb88-69b9-4744-9c19-da6e774add67';

-- =============================================
-- STEP 4: Merge any remaining duplicates dynamically
-- =============================================
DO $$
DECLARE
  dup RECORD;
BEGIN
  FOR dup IN
    SELECT remove_id, keep_id FROM (
      SELECT c1.id as remove_id, c2.id as keep_id
      FROM contacts c1
      JOIN contacts c2 ON c1.tenant_id = c2.tenant_id
        AND lower(trim(c1.first_name)) = lower(trim(c2.first_name))
        AND lower(trim(coalesce(c1.last_name, ''))) = lower(trim(coalesce(c2.last_name, '')))
        AND normalize_street(c1.address_street) = normalize_street(c2.address_street)
        AND c1.created_at > c2.created_at
      WHERE c1.first_name IS NOT NULL AND c1.address_street IS NOT NULL AND c1.tenant_id IS NOT NULL
    ) sub
  LOOP
    UPDATE pipeline_entries SET contact_id = dup.keep_id WHERE contact_id = dup.remove_id;
    UPDATE agreement_instances SET contact_id = dup.keep_id WHERE contact_id = dup.remove_id;
    UPDATE ai_contact_memory SET contact_id = dup.keep_id WHERE contact_id = dup.remove_id;
    UPDATE ai_conversations SET contact_id = dup.keep_id WHERE contact_id = dup.remove_id;
    DELETE FROM contacts WHERE id = dup.remove_id;
  END LOOP;
END $$;

-- =============================================
-- STEP 5: Recreate unique index with normalization
-- =============================================
DROP INDEX IF EXISTS idx_contacts_unique_name_address;

CREATE UNIQUE INDEX idx_contacts_unique_name_address
ON public.contacts (
  tenant_id,
  lower(trim(first_name)),
  lower(trim(coalesce(last_name, ''))),
  normalize_street(address_street)
)
WHERE first_name IS NOT NULL
  AND address_street IS NOT NULL
  AND tenant_id IS NOT NULL;

-- =============================================
-- STEP 6: Update validation trigger
-- =============================================
CREATE OR REPLACE FUNCTION check_contact_duplicate()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.first_name IS NOT NULL AND NEW.address_street IS NOT NULL 
     AND NEW.tenant_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.contacts
      WHERE tenant_id = NEW.tenant_id
        AND lower(trim(first_name)) = lower(trim(NEW.first_name))
        AND lower(trim(coalesce(last_name, ''))) = lower(trim(coalesce(NEW.last_name, '')))
        AND normalize_street(address_street) = normalize_street(NEW.address_street)
        AND id != coalesce(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
    ) THEN
      RAISE EXCEPTION 'A contact named "% %" at "%" already exists',
        NEW.first_name, coalesce(NEW.last_name, ''), NEW.address_street;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
