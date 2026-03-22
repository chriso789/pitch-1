

# Fix "Contact Already Exists" Error for Roof Kings

## Root Cause

There are **two problems** working together:

1. **Edge function bug (lead creation)**: When Jared clicks "Create Anyway" after seeing the duplicate warning, the `forceDuplicate` flag bypasses the soft warning but the code **fails to reuse the existing contact**. It falls through and tries to insert a brand new contact with the same name and address, which hits the `check_contact_duplicate` database trigger and crashes.

2. **ContactForm (standalone contact creation)**: When creating a contact directly (not through the lead form), the insert goes straight to the database. If a contact with the same name and normalized address already exists in Roof Kings' tenant, the trigger blocks it with no override option.

## Fix

### 1. Edge function: Reuse existing contact on `forceDuplicate`

**File**: `supabase/functions/create-lead-with-contact/index.ts` (~line 298-313)

When `forceDuplicate=true` and a duplicate is found, **use the existing contact's ID** instead of trying to create a new one:

```typescript
if (duplicate && !body.forceDuplicate) {
  // return warning response (existing code)
} else if (duplicate && body.forceDuplicate) {
  // REUSE the existing contact — don't try to insert a new one
  contactId = duplicate.id;
  console.log("[create-lead-with-contact] Force duplicate: reusing existing contact", contactId);
}
```

This way "Create Anyway" creates a new **lead/pipeline entry** linked to the existing contact, which is the correct behavior (a contact can have a new project at the same address).

### 2. ContactForm: Show a clear error with guidance

**File**: `src/features/contacts/components/ContactForm.tsx` (~line 365-381)

Add a specific check for the duplicate trigger error message to show a helpful message instead of the raw database error:

```typescript
} else if (error.message?.includes('already exists')) {
  errorMessage = "A contact with this name and address already exists. Please search for the existing contact instead.";
}
```

### 3. Redeploy the edge function

Deploy the updated `create-lead-with-contact` function so the fix takes effect immediately.

## Summary

| Change | File | What |
|--------|------|------|
| Reuse existing contact on force-duplicate | `supabase/functions/create-lead-with-contact/index.ts` | Set `contactId = duplicate.id` instead of inserting |
| Better error message | `src/features/contacts/components/ContactForm.tsx` | User-friendly duplicate guidance |
| Deploy | Edge function | Push updated function |

## Expected Outcome
- Jared can create leads for contacts that already exist in Roof Kings (reuses the contact record, creates a new pipeline entry)
- Standalone contact creation shows a clear message explaining the contact already exists
- No cross-company data leakage — the duplicate check is always scoped to `tenant_id`

