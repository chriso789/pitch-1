-- Step 1: Create temp mapping
CREATE TEMP TABLE _dup_map AS
WITH ranked AS (
  SELECT id, tenant_id,
         lower(trim(first_name)) AS fn,
         lower(trim(coalesce(last_name, ''))) AS ln,
         lower(trim(address_street)) AS addr,
         ROW_NUMBER() OVER (
           PARTITION BY tenant_id, lower(trim(first_name)), lower(trim(coalesce(last_name, ''))), lower(trim(address_street))
           ORDER BY created_at ASC
         ) AS rn
  FROM public.contacts
  WHERE first_name IS NOT NULL AND address_street IS NOT NULL AND tenant_id IS NOT NULL
)
SELECT r.id AS dup_id, k.id AS keep_id
FROM ranked r
JOIN ranked k ON k.tenant_id = r.tenant_id AND k.fn = r.fn AND k.ln = r.ln AND k.addr = r.addr AND k.rn = 1
WHERE r.rn > 1;

-- Step 2: Reassign ALL FK references (including CASCADE ones to prevent chain issues)
-- CASCADE FK tables (must reassign to prevent cascade-delete chain problems)
UPDATE pipeline_entries SET contact_id = m.keep_id FROM _dup_map m WHERE contact_id = m.dup_id;
UPDATE portal_access_grants SET contact_id = m.keep_id FROM _dup_map m WHERE contact_id = m.dup_id;
UPDATE lead_scoring_history SET contact_id = m.keep_id FROM _dup_map m WHERE contact_id = m.dup_id;
UPDATE nurturing_enrollments SET contact_id = m.keep_id FROM _dup_map m WHERE contact_id = m.dup_id;
UPDATE jobs SET contact_id = m.keep_id FROM _dup_map m WHERE contact_id = m.dup_id;
UPDATE skip_trace_results SET contact_id = m.keep_id FROM _dup_map m WHERE contact_id = m.dup_id;
UPDATE customer_reviews SET contact_id = m.keep_id FROM _dup_map m WHERE contact_id = m.dup_id;
UPDATE satisfaction_surveys SET contact_id = m.keep_id FROM _dup_map m WHERE contact_id = m.dup_id;
UPDATE customer_portal_tokens SET contact_id = m.keep_id FROM _dup_map m WHERE contact_id = m.dup_id;
UPDATE customer_messages SET contact_id = m.keep_id FROM _dup_map m WHERE contact_id = m.dup_id;
UPDATE homeowner_portal_sessions SET contact_id = m.keep_id FROM _dup_map m WHERE contact_id = m.dup_id;
UPDATE customer_referrals SET referrer_contact_id = m.keep_id FROM _dup_map m WHERE referrer_contact_id = m.dup_id;
UPDATE customer_rewards SET contact_id = m.keep_id FROM _dup_map m WHERE contact_id = m.dup_id;
UPDATE reward_redemptions SET contact_id = m.keep_id FROM _dup_map m WHERE contact_id = m.dup_id;
UPDATE attorney_requests SET contact_id = m.keep_id FROM _dup_map m WHERE contact_id = m.dup_id;
UPDATE service_quote_requests SET contact_id = m.keep_id FROM _dup_map m WHERE contact_id = m.dup_id;
UPDATE customer_photos SET contact_id = m.keep_id FROM _dup_map m WHERE contact_id = m.dup_id;

-- NO ACTION FK tables
UPDATE communication_history SET contact_id = m.keep_id FROM _dup_map m WHERE contact_id = m.dup_id;
UPDATE documents SET contact_id = m.keep_id FROM _dup_map m WHERE contact_id = m.dup_id;
UPDATE calls SET contact_id = m.keep_id FROM _dup_map m WHERE contact_id = m.dup_id;
UPDATE dialer_list_items SET contact_id = m.keep_id FROM _dup_map m WHERE contact_id = m.dup_id;
UPDATE tasks SET contact_id = m.keep_id FROM _dup_map m WHERE contact_id = m.dup_id;
UPDATE follow_up_instances SET contact_id = m.keep_id FROM _dup_map m WHERE contact_id = m.dup_id;
UPDATE presentation_sessions SET contact_id = m.keep_id FROM _dup_map m WHERE contact_id = m.dup_id;

-- SET NULL FK tables
UPDATE agreement_instances SET contact_id = m.keep_id FROM _dup_map m WHERE contact_id = m.dup_id;
UPDATE call_logs SET contact_id = m.keep_id FROM _dup_map m WHERE contact_id = m.dup_id;
UPDATE asterisk_channels SET contact_id = m.keep_id FROM _dup_map m WHERE contact_id = m.dup_id;
UPDATE voice_recordings SET contact_id = m.keep_id FROM _dup_map m WHERE contact_id = m.dup_id;
UPDATE marketing_sessions SET contact_id = m.keep_id FROM _dup_map m WHERE contact_id = m.dup_id;
UPDATE tracking_events SET contact_id = m.keep_id FROM _dup_map m WHERE contact_id = m.dup_id;
UPDATE visitor_consents SET contact_id = m.keep_id FROM _dup_map m WHERE contact_id = m.dup_id;
UPDATE security_alerts SET contact_id = m.keep_id FROM _dup_map m WHERE contact_id = m.dup_id;
UPDATE canvassiq_properties SET contact_id = m.keep_id FROM _dup_map m WHERE contact_id = m.dup_id;
UPDATE unified_inbox SET contact_id = m.keep_id FROM _dup_map m WHERE contact_id = m.dup_id;
UPDATE sms_threads SET contact_id = m.keep_id FROM _dup_map m WHERE contact_id = m.dup_id;
UPDATE sms_messages SET contact_id = m.keep_id FROM _dup_map m WHERE contact_id = m.dup_id;
UPDATE inbound_messages SET contact_id = m.keep_id FROM _dup_map m WHERE contact_id = m.dup_id;
UPDATE appointments SET contact_id = m.keep_id FROM _dup_map m WHERE contact_id = m.dup_id;
UPDATE ai_measurement_analysis SET contact_id = m.keep_id FROM _dup_map m WHERE contact_id = m.dup_id;
UPDATE ai_contact_memory SET contact_id = m.keep_id FROM _dup_map m WHERE contact_id = m.dup_id;
UPDATE ai_conversations SET contact_id = m.keep_id FROM _dup_map m WHERE contact_id = m.dup_id;
UPDATE ai_outreach_queue SET contact_id = m.keep_id FROM _dup_map m WHERE contact_id = m.dup_id;
UPDATE ai_scheduling_suggestions SET contact_id = m.keep_id FROM _dup_map m WHERE contact_id = m.dup_id;

-- Step 3: Delete the duplicate contacts (should now have no remaining references)
DELETE FROM public.contacts WHERE id IN (SELECT dup_id FROM _dup_map);

-- Step 4: Cleanup
DROP TABLE _dup_map;

-- Step 5: Create unique index
CREATE UNIQUE INDEX idx_contacts_unique_name_address
ON public.contacts (
  tenant_id,
  lower(trim(first_name)),
  lower(trim(coalesce(last_name, ''))),
  lower(trim(address_street))
)
WHERE first_name IS NOT NULL
  AND address_street IS NOT NULL
  AND tenant_id IS NOT NULL;

-- Step 6: Validation trigger
CREATE OR REPLACE FUNCTION check_contact_duplicate()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.first_name IS NOT NULL AND NEW.address_street IS NOT NULL AND NEW.tenant_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM public.contacts
      WHERE tenant_id = NEW.tenant_id
        AND lower(trim(first_name)) = lower(trim(NEW.first_name))
        AND lower(trim(coalesce(last_name, ''))) = lower(trim(coalesce(NEW.last_name, '')))
        AND lower(trim(address_street)) = lower(trim(NEW.address_street))
        AND id != coalesce(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
    ) THEN
      RAISE EXCEPTION 'A contact named "% %" at "%" already exists',
        NEW.first_name, coalesce(NEW.last_name, ''), NEW.address_street;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_check_contact_duplicate
BEFORE INSERT OR UPDATE ON public.contacts
FOR EACH ROW EXECUTE FUNCTION check_contact_duplicate();