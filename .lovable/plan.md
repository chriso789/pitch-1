

# Plan: Replace Phone-Based Dedup with Name+Address Duplicate Warning

## What Changes

The current edge function (`create-lead-with-contact/index.ts`) silently merges new leads into existing contacts based on phone number matching. This caused David Ramage's lead to be linked to Punit Shah. The user wants:

1. **Remove phone and email dedup entirely** -- never auto-link based on phone/email
2. **Add name + address duplicate detection** -- if a contact with the same first name, last name, and street address already exists in the tenant, return a warning flag instead of silently merging
3. **Client-side confirmation** -- show the user a warning dialog when a duplicate is detected, letting them choose to proceed (create anyway) or cancel

## File Changes

### 1. `supabase/functions/create-lead-with-contact/index.ts`

**Remove lines 275-313** (phone dedup and email dedup blocks entirely).

**Replace with name + address duplicate check:**
```typescript
// Check for duplicate by name + address (warn, don't auto-merge)
if (!contactId && body.name) {
  const nameParts = body.name.split(" ");
  const firstName = nameParts[0] || "";
  const lastName = nameParts.slice(1).join(" ") || "";
  
  if (firstName && addressComponents.street) {
    const { data: nameAddrMatch } = await supabase
      .from("contacts")
      .select("id, first_name, last_name, address_street, location_id")
      .eq("tenant_id", tenantId)
      .eq("is_deleted", false)
      .ilike("first_name", firstName)
      .ilike("last_name", lastName)
      .limit(5);
    
    // Check for street match among results
    const duplicate = nameAddrMatch?.find(c => 
      c.address_street?.toLowerCase().trim() === addressComponents.street.toLowerCase().trim()
    );
    
    if (duplicate && !body.forceDuplicate) {
      return new Response(JSON.stringify({
        success: false,
        duplicate: true,
        existingContact: duplicate,
        message: `A contact named "${firstName} ${lastName}" already exists at this address.`
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 });
    }
  }
}
```

**Also remove lines 315-330** (address-only dedup fallback) and **lines 332-344** (assigned_to sync on matched contact).

**Add `forceDuplicate` to the body destructuring** at the top of the function.

### 2. `src/components/EnhancedLeadCreationDialog.tsx`

**Update `handleSubmit`** (~line 396-418): After calling the edge function, check for a `duplicate` flag in the response. If found, show a confirmation dialog asking the user whether to proceed.

- Add state: `const [duplicateWarning, setDuplicateWarning] = useState<{message: string, existingContact: any} | null>(null)`
- In handleSubmit, when `data?.duplicate === true`, set the warning state and return early
- Add a confirmation handler that re-calls the edge function with `forceDuplicate: true`
- Add an AlertDialog that displays the duplicate warning with "Create Anyway" and "Cancel" buttons

### 3. Data Fix (David Ramage)

Run a SQL update via the insert tool to ensure the existing David Ramage pipeline entry stays in West Coast (it already has the West Coast `location_id`, so this just needs verification -- no change needed if it's already correct).

---

**Summary**: Remove all phone/email auto-merge logic from the edge function. Replace with name+address duplicate detection that returns a warning to the UI. The client shows a confirmation dialog, and only creates the duplicate if the user explicitly confirms. Three touches: edge function, dialog component, and function redeploy.

