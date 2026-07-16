-- Drop the redundant early-firing contact numbering trigger.
-- Two triggers were assigning contact_number/clj_formatted_number. The
-- alphabetically-first one (assign_contact_number) ran BEFORE the location
-- was auto-set, so it computed a stale contact_number=1 against a NULL
-- location. The second trigger (trigger_assign_contact_number) then
-- recomputed clj_formatted_number using the newly-set location code but
-- the same stale contact_number=1, producing collisions like
-- HQ2-0001-00-00 that violate uniq_contacts_tenant_clj.
--
-- Keeping only trigger_assign_contact_number, which fires alphabetically
-- last (after auto_set_location_contacts / ensure_contact_location have
-- populated location_id), so numbering happens once with the correct
-- location.

DROP TRIGGER IF EXISTS assign_contact_number ON public.contacts;