

# Plan: Fix Lead Creation — Missing `lead_name` + Phone Dedup False Match

## Root Cause (Two Bugs Found)

The "David Ramage" lead **was created successfully** (ID: `e9a27514-bc6f-4b42-9dd9-fa9d74c6a886`) but is invisible because:

1. **`lead_name` is never set** — The edge function `create-lead-with-contact` builds the pipeline entry without `lead_name: body.name`. The pipeline UI falls back to the linked contact's name, and search queries on `lead_name` return nothing.

2. **Phone dedup matched the wrong contact** — Phone `11111111` matched "Punit Shah" (phone `111111111`) via loose `ilike` matching. So David Ramage's lead is linked to Punit Shah's contact record, not a new "David Ramage" contact. The card shows "Punit Shah" instead of "David Ramage."

## Fix

### 1. `supabase/functions/create-lead-with-contact/index.ts`

**Add `lead_name` to pipeline insert** (line 398-416):
```typescript
const pipelineData: any = {
  tenant_id: tenantId,
  contact_id: contactId,
  location_id: locationId,
  lead_name: body.name || null,  // <-- ADD THIS
  status: body.status || "lead",
  ...
};
```

**Fix phone dedup to require exact 10-digit match** (line 276-292):
Currently uses `or('phone.ilike.%${normalizedPhone}')` which is a substring match — `11111111` matches `111111111`. Change to exact normalized comparison:
```typescript
const normalizedPhone = body.phone.replace(/\D/g, '').slice(-10);
if (normalizedPhone.length === 10) {
  // Use exact match on last 10 digits instead of substring ilike
  const { data: phoneMatch } = await supabase
    .from("contacts")
    .select("id, first_name, last_name, assigned_to, phone")
    .eq("tenant_id", tenantId)
    .eq("is_deleted", false)
    .limit(10);
  
  // Filter in JS for exact 10-digit match
  const exactMatch = phoneMatch?.find(c => 
    c.phone?.replace(/\D/g, '').slice(-10) === normalizedPhone
  );
}
```

Alternatively, a simpler approach: only match if the normalized phone is at least 10 digits long, and use a tighter SQL filter.

### 2. Fix the existing David Ramage record

Run a SQL update to set the `lead_name` on the existing entry:
```sql
UPDATE pipeline_entries 
SET lead_name = 'David Ramage' 
WHERE id = 'e9a27514-bc6f-4b42-9dd9-fa9d74c6a886';
```

### 3. Redeploy the edge function

After editing, the `create-lead-with-contact` function must be redeployed.

---

**Summary**: Two lines of change in the edge function — add `lead_name` to the insert and tighten phone dedup to require 10-digit exact match. Plus a one-time data fix for the existing record.

