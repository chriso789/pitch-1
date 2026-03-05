

# Fix: Auto-Lead Creation & Duplicate Contacts Despite Constraint

## Issue 1: Contacts Automatically Getting Leads

**Root cause**: The `sync_new_contact_to_pipeline` trigger on the `contacts` table fires on INSERT when `qualification_status IN ('qualified', 'interested')`. While the default is `'unqualified'`, some creation flows (bulk import, webhooks, CanvassIQ) may set a non-default qualification status at insert time, causing an automatic pipeline entry.

Additionally, when a user changes the qualification dropdown on the Contact Profile to "qualified" or "interested," the `sync_contact_to_pipeline` UPDATE trigger fires and creates a lead silently — without confirmation.

**Fix**: Remove the automatic INSERT trigger (`sync_new_contact_to_pipeline`). Leads should only be created via explicit user action ("Create Lead" button). The UPDATE trigger can remain but should be gated so it only fires when the user explicitly creates a lead, not just from changing a dropdown.

### Database Migration

```sql
-- Remove the auto-create-lead-on-insert trigger
DROP TRIGGER IF EXISTS sync_new_contact_to_pipeline ON contacts;

-- Update the UPDATE trigger to NOT auto-create leads 
-- when qualification_status changes — leads should only be 
-- created via explicit "Create Lead" action
DROP TRIGGER IF EXISTS sync_contact_to_pipeline ON contacts;
```

This means leads are only created when a user clicks "Create Lead" on the Contact Profile or Pipeline page — never silently from a status change or contact insert.

---

## Issue 2: Duplicate "jean louis" Despite Unique Constraint

**Root cause**: The unique index `idx_contacts_unique_name_address` compares `lower(trim(address_street))` exactly. The two records have:
- "634 Angler Dr" 
- "634 Angler Drive"

These are different strings, so the index allows both. Street suffix abbreviations (Dr/Drive, St/Street, Ave/Avenue, etc.) are not normalized.

**Fix**: Create a SQL function that normalizes common street suffixes before comparison, and use it in both the unique index and the validation trigger.

### Database Migration

```sql
-- Street normalization function
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
                  regexp_replace(street,
                    '\y(drive)\y', 'dr', 'gi'),
                  '\y(street)\y', 'st', 'gi'),
                '\y(avenue)\y', 'ave', 'gi'),
              '\y(boulevard)\y', 'blvd', 'gi'),
            '\y(court)\y', 'ct', 'gi'),
          '\y(place)\y', 'pl', 'gi'),
        '\y(lane)\y', 'ln', 'gi'),
      '\y(road)\y', 'rd', 'gi')
  ));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Drop old index
DROP INDEX IF EXISTS idx_contacts_unique_name_address;

-- Recreate with normalized street
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

-- Update validation trigger to use normalize_street
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
```

Before creating the new index, merge the existing "jean louis" duplicates (reassign pipeline entries, documents, etc. from the newer record to the older one, then delete the newer record) — same pattern used in the previous duplicate cleanup migration.

---

## Summary

| Issue | Cause | Fix |
|-------|-------|-----|
| Contacts auto-getting leads | INSERT trigger on contacts creates pipeline entry | Drop the auto-create triggers; leads only via explicit action |
| Duplicate "jean louis" | "Dr" vs "Drive" bypasses exact-match index | Normalize street suffixes in index and trigger |

