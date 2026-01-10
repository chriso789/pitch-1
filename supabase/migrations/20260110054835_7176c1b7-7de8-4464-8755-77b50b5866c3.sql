-- ============================================
-- FIX LOGO UPLOAD RLS + MULTI-BRAND ENFORCEMENT
-- ============================================

-- 1) Fix get_user_tenant_ids() to include user_company_access tenants
CREATE OR REPLACE FUNCTION public.get_user_tenant_ids(p_user_id uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ARRAY(
    -- Include tenant_id and active_tenant_id from profiles
    SELECT DISTINCT unnest(ARRAY[p.tenant_id, p.active_tenant_id])
    FROM public.profiles p
    WHERE p.id = p_user_id
    AND (p.tenant_id IS NOT NULL OR p.active_tenant_id IS NOT NULL)
    
    UNION
    
    -- Include ALL tenant IDs from user_company_access
    SELECT uca.tenant_id
    FROM public.user_company_access uca
    WHERE uca.user_id = p_user_id
    AND uca.is_active = true
  )::uuid[];
$$;

-- 2) Create default brand for each tenant that doesn't have one
INSERT INTO brands (tenant_id, name, slug, is_default, created_at, updated_at)
SELECT
  t.id AS tenant_id,
  t.name || ' Default' AS name,
  'default' AS slug,
  true AS is_default,
  now(),
  now()
FROM tenants t
LEFT JOIN brands b ON b.tenant_id = t.id
WHERE b.id IS NULL
ON CONFLICT DO NOTHING;

-- 3) Ensure only one default brand per tenant (fix any legacy issues)
WITH ranked AS (
  SELECT
    id,
    tenant_id,
    row_number() OVER (PARTITION BY tenant_id ORDER BY created_at ASC, id ASC) AS rn
  FROM brands
  WHERE is_default = true
)
UPDATE brands b
SET is_default = false
FROM ranked r
WHERE b.id = r.id AND r.rn > 1;

-- 4) Create unique index to enforce one default brand per tenant
CREATE UNIQUE INDEX IF NOT EXISTS brands_one_default_per_tenant
ON brands(tenant_id) WHERE is_default = true;

-- 5) Backfill contacts.brand_id using tenant default
UPDATE contacts c
SET brand_id = (
  SELECT b.id FROM brands b 
  WHERE b.tenant_id = c.tenant_id AND b.is_default = true 
  LIMIT 1
)
WHERE c.brand_id IS NULL;

-- 6) Backfill conversations.brand_id from contact or default
UPDATE conversations cv
SET brand_id = COALESCE(
  (SELECT ct.brand_id FROM contacts ct WHERE ct.id = cv.contact_id),
  (SELECT b.id FROM brands b WHERE b.tenant_id = cv.tenant_id AND b.is_default = true LIMIT 1)
)
WHERE cv.brand_id IS NULL;

-- 7) Backfill sms_messages.brand_id from conversations
UPDATE sms_messages m
SET brand_id = (
  SELECT c.brand_id FROM conversations c WHERE c.id = m.conversation_id
)
WHERE m.brand_id IS NULL
AND m.conversation_id IS NOT NULL;

-- 8) Backfill calls.brand_id from conversations
UPDATE calls ca
SET brand_id = (
  SELECT c.brand_id FROM conversations c WHERE c.id = ca.conversation_id
)
WHERE ca.brand_id IS NULL
AND ca.conversation_id IS NOT NULL;

-- 9) Helper function: get default brand for a tenant
CREATE OR REPLACE FUNCTION public.get_default_brand_id(_tenant_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT b.id FROM brands b
  WHERE b.tenant_id = _tenant_id AND b.is_default = true
  ORDER BY b.created_at ASC LIMIT 1;
$$;

-- 10) Brand ↔ Location tenant match trigger
CREATE OR REPLACE FUNCTION public.enforce_brand_location_tenant_match()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  loc_tenant uuid;
BEGIN
  IF NEW.location_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT tenant_id INTO loc_tenant
  FROM locations
  WHERE id = NEW.location_id;

  IF loc_tenant IS NULL THEN
    RAISE EXCEPTION 'brands.location_id references missing location';
  END IF;

  IF loc_tenant <> NEW.tenant_id THEN
    RAISE EXCEPTION 'Brand location tenant mismatch: brand.tenant_id % != locations.tenant_id %',
      NEW.tenant_id, loc_tenant;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_brand_location_tenant_match ON brands;
CREATE TRIGGER trg_brand_location_tenant_match
BEFORE INSERT OR UPDATE OF location_id, tenant_id
ON brands
FOR EACH ROW EXECUTE FUNCTION public.enforce_brand_location_tenant_match();

-- 11) Conversation brand snapshot trigger
CREATE OR REPLACE FUNCTION public.enforce_conversation_brand_snapshot()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  contact_tenant uuid;
  contact_brand uuid;
  default_brand uuid;
  brand_tenant uuid;
  brand_location uuid;
BEGIN
  IF NEW.tenant_id IS NULL THEN
    RAISE EXCEPTION 'conversations.tenant_id is required';
  END IF;

  IF NEW.contact_id IS NOT NULL THEN
    SELECT c.tenant_id, c.brand_id INTO contact_tenant, contact_brand
    FROM contacts c WHERE c.id = NEW.contact_id;

    IF contact_tenant IS NULL THEN
      RAISE EXCEPTION 'conversations.contact_id references missing contact';
    END IF;

    IF contact_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'Conversation tenant mismatch';
    END IF;

    IF contact_brand IS NOT NULL THEN
      IF NEW.brand_id IS NULL THEN
        NEW.brand_id := contact_brand;
      ELSIF NEW.brand_id <> contact_brand THEN
        RAISE EXCEPTION 'Conversation brand mismatch';
      END IF;
    END IF;
  END IF;

  IF NEW.brand_id IS NULL THEN
    default_brand := get_default_brand_id(NEW.tenant_id);
    IF default_brand IS NOT NULL THEN
      NEW.brand_id := default_brand;
    END IF;
  END IF;

  IF NEW.brand_id IS NOT NULL THEN
    SELECT b.tenant_id, b.location_id INTO brand_tenant, brand_location
    FROM brands b WHERE b.id = NEW.brand_id;

    IF brand_tenant IS NULL THEN
      RAISE EXCEPTION 'conversations.brand_id references missing brand';
    END IF;

    IF brand_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'Conversation brand.tenant_id mismatch';
    END IF;

    IF brand_location IS NOT NULL AND NEW.location_id IS NULL THEN
      NEW.location_id := brand_location;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_conversation_brand_snapshot ON conversations;
CREATE TRIGGER trg_conversation_brand_snapshot
BEFORE INSERT OR UPDATE OF tenant_id, contact_id, brand_id, location_id
ON conversations
FOR EACH ROW EXECUTE FUNCTION public.enforce_conversation_brand_snapshot();

-- 12) SMS Messages brand/tenant enforcement trigger
CREATE OR REPLACE FUNCTION public.enforce_sms_message_brand_tenant()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  convo_tenant uuid;
  convo_brand uuid;
BEGIN
  IF NEW.tenant_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.conversation_id IS NOT NULL THEN
    SELECT c.tenant_id, c.brand_id INTO convo_tenant, convo_brand
    FROM conversations c WHERE c.id = NEW.conversation_id;

    IF convo_tenant IS NOT NULL AND convo_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'SMS message tenant mismatch';
    END IF;

    IF convo_brand IS NOT NULL THEN
      IF NEW.brand_id IS NULL THEN
        NEW.brand_id := convo_brand;
      ELSIF NEW.brand_id <> convo_brand THEN
        RAISE EXCEPTION 'SMS message brand mismatch';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sms_message_brand_tenant ON sms_messages;
CREATE TRIGGER trg_sms_message_brand_tenant
BEFORE INSERT OR UPDATE OF tenant_id, conversation_id, brand_id
ON sms_messages
FOR EACH ROW EXECUTE FUNCTION public.enforce_sms_message_brand_tenant();

-- 13) Calls brand/tenant enforcement trigger
CREATE OR REPLACE FUNCTION public.enforce_call_brand_tenant()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  convo_tenant uuid;
  convo_brand uuid;
BEGIN
  IF NEW.tenant_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.conversation_id IS NOT NULL THEN
    SELECT c.tenant_id, c.brand_id INTO convo_tenant, convo_brand
    FROM conversations c WHERE c.id = NEW.conversation_id;

    IF convo_tenant IS NOT NULL AND convo_tenant <> NEW.tenant_id THEN
      RAISE EXCEPTION 'Call tenant mismatch';
    END IF;

    IF convo_brand IS NOT NULL THEN
      IF NEW.brand_id IS NULL THEN
        NEW.brand_id := convo_brand;
      ELSIF NEW.brand_id <> convo_brand THEN
        RAISE EXCEPTION 'Call brand mismatch';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_call_brand_tenant ON calls;
CREATE TRIGGER trg_call_brand_tenant
BEFORE INSERT OR UPDATE OF tenant_id, conversation_id, brand_id
ON calls
FOR EACH ROW EXECUTE FUNCTION public.enforce_call_brand_tenant();