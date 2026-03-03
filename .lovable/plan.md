

# Prevent Duplicate Contacts with Same Name + Address

## Problem
The system currently has no database-level constraint preventing two contacts with the same name and address within a tenant. This allows duplicates like the two "Wendell King" records seen in the Kanban board.

## Solution
Add a **unique index** on `(tenant_id, lower(first_name), lower(last_name), lower(address_street))` so the database itself rejects duplicates. Using a partial unique index (only where these fields are NOT NULL) avoids blocking contacts that don't have an address yet.

Additionally, add a **validation trigger** that checks for name+address duplicates before insert/update and returns a clear error message, so the frontend can display a meaningful toast instead of a raw DB error.

### Database Migration

```sql
-- Unique index: same tenant + same name + same street = duplicate
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

-- Validation function with friendly error
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
```

### Frontend — No code changes needed
The existing error handling in `ContactForm`, `ContactBulkImport`, and `CreateContactDialog` already catches insert/update errors and displays them via `toast.error()`. The trigger's RAISE EXCEPTION message will surface naturally.

### What this covers
- Manual contact creation (ContactForm, CreateContactDialog)
- Bulk imports (will reject rows that match existing name+address)
- Contact updates (prevents editing into a duplicate)
- Case-insensitive and trim-aware matching

