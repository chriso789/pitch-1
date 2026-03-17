

# Batch Update Contact Statuses from Uploaded CSV Data

## What we know

The uploaded `.numbers` file contains ~490 rows of contact data for both **Michael Grosso** and **Uri Kaweblum** pins. Column 9 (0-indexed: col 8) contains the status. Many contacts appear multiple times with different statuses as they progressed — we need the **latest entry per contact** (by date in column 1).

### Unique statuses in the file and their mappings

| CSV Status | DB Status Key | Exists in Tenant? |
|---|---|---|
| Not Home | `not_home` | Yes |
| Interested | `interested` | Yes |
| Not Interested | `not_interested` | Yes |
| Old Roof Marketing | `old_roof_marketing` | Yes |
| Storm Damage Marketing | `storm_damage` | Yes |
| New Roof | `new_roof` | Yes |
| Contract Signed | `qualified` | Yes |
| Contingency signed | `qualified` | Yes |
| Go Back | `follow_up` | **No — needs to be created** |
| Not Contacted | `not_home` | Yes (fallback) |

### Missing status: "Go Back" → need a new `follow_up` status

The tenant doesn't have a "Follow Up" or "Go Back" status. We need to create one via migration.

## Plan

### 1. Create "Go Back" contact status for this tenant
- Add a new row to `contact_statuses` for tenant `14de934e-...` with `key: 'go_back'`, `name: 'Go Back'`, `color: '#f59e0b'` (amber), `status_order: 9`

### 2. Create a new edge function `batch-update-contact-statuses`

A lightweight one-off function that:
- Accepts `{ updates: [{first_name, last_name, address_street, qualification_status}], tenant_id }`
- For each entry, finds the contact by name + address (ilike match, same as reconcile-contacts)
- Updates `qualification_status` on the matched contact
- Returns counts of updated/skipped/errors

### 3. Write a Python script to parse the file and call the edge function

- Parse the `.numbers` file (already parsed — extract from the document parse output)
- Deduplicate by name+address, keeping the **latest date** entry
- Map CSV statuses to DB status keys
- Call the edge function in batches of 25

### Status mapping in the script
```text
"Old Roof Marketing"     → "old_roof_marketing"
"Storm Damage Marketing" → "storm_damage"
"Contract Signed"        → "qualified"
"Contingency signed"     → "qualified"
"Not Interested"         → "not_interested"
"Not Home"               → "not_home"
"Interested"             → "interested"
"New Roof"               → "new_roof"
"Go Back"                → "go_back"
"Not Contacted"          → "not_home"
```

### 4. Also fix `reconcile-contacts` for future imports

Add `qualification_status` to the `ContactPayload` interface and include it in both the insert and update paths, so future CSV imports carry status through automatically.

## Files changed
1. **Migration**: Insert `go_back` status into `contact_statuses`
2. **New**: `supabase/functions/batch-update-contact-statuses/index.ts`
3. **Script**: Python script to parse data and call the function
4. **Edit**: `supabase/functions/reconcile-contacts/index.ts` — add `qualification_status` support

