-- Merge duplicate Mike Stipp: keep 442dc12d, remove a900ae5a
-- The new contact already has a pipeline entry, so soft-delete the old one
UPDATE pipeline_entries SET is_deleted = true, deleted_at = now() WHERE contact_id = 'a900ae5a-f0d7-45ce-bcb9-803c13828027';

-- Move tasks and agreements
UPDATE tasks SET contact_id = '442dc12d-4382-4db2-a82e-54db86820b75' WHERE contact_id = 'a900ae5a-f0d7-45ce-bcb9-803c13828027';
UPDATE agreement_instances SET contact_id = '442dc12d-4382-4db2-a82e-54db86820b75' WHERE contact_id = 'a900ae5a-f0d7-45ce-bcb9-803c13828027';

-- Delete the duplicate contact
DELETE FROM contacts WHERE id = 'a900ae5a-f0d7-45ce-bcb9-803c13828027';

-- Improve normalize_street to strip trailing city/state/zip and periods
CREATE OR REPLACE FUNCTION normalize_street(street text)
RETURNS text AS $$
DECLARE
  cleaned text;
BEGIN
  cleaned := regexp_replace(street, ',.*$', '');
  cleaned := regexp_replace(cleaned, '\s+(US|USA)\s*$', '', 'i');
  cleaned := regexp_replace(cleaned, '\s+\d{5}(-\d{4})?\s*$', '');
  cleaned := regexp_replace(cleaned, '\s+[A-Z]{2}\s*$', '');
  cleaned := regexp_replace(cleaned, '\.(\s|$)', '\1', 'g');
  
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
                          regexp_replace(cleaned,
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
$$ LANGUAGE plpgsql IMMUTABLE