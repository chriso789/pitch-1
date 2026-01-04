-- Backfill contacts with missing location_id to use tenant's primary location
UPDATE contacts c
SET location_id = (
  SELECT l.id FROM locations l 
  WHERE l.tenant_id = c.tenant_id 
  AND l.is_primary = true 
  LIMIT 1
)
WHERE c.location_id IS NULL
AND EXISTS (
  SELECT 1 FROM locations l 
  WHERE l.tenant_id = c.tenant_id 
  AND l.is_primary = true
);

-- For contacts still without location_id, use any active location
UPDATE contacts c
SET location_id = (
  SELECT l.id FROM locations l 
  WHERE l.tenant_id = c.tenant_id 
  AND l.is_active = true 
  LIMIT 1
)
WHERE c.location_id IS NULL
AND EXISTS (
  SELECT 1 FROM locations l 
  WHERE l.tenant_id = c.tenant_id 
  AND l.is_active = true
);

-- Create trigger function to auto-set location_id on new contacts
CREATE OR REPLACE FUNCTION set_default_location_id()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.location_id IS NULL THEN
    -- Get primary location for tenant
    SELECT id INTO NEW.location_id
    FROM locations
    WHERE tenant_id = NEW.tenant_id
    AND is_primary = true
    LIMIT 1;
    
    -- If no primary, get any active location
    IF NEW.location_id IS NULL THEN
      SELECT id INTO NEW.location_id
      FROM locations
      WHERE tenant_id = NEW.tenant_id
      AND is_active = true
      LIMIT 1;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger on contacts table
DROP TRIGGER IF EXISTS ensure_contact_location ON contacts;
CREATE TRIGGER ensure_contact_location
  BEFORE INSERT ON contacts
  FOR EACH ROW
  EXECUTE FUNCTION set_default_location_id();