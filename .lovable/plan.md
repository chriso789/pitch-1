

# Fix Signature Email: Company Domain and Subject Line

## Problems Found

### 1. Email comes from "PITCH CRM" instead of "O'Brien Contracting"

**Root cause:** The `email-signature-request` function (line 66) tries to join tenant data using PostgREST:
```
.select("*, tenant:tenant_id(name, settings)")
```
But `signature_envelopes.tenant_id` has **no foreign key constraint** to the `tenants` table, so the join silently returns `null`. This causes:
- `tenantName` falls back to `"PITCH CRM"` (line 70)
- `tenantId` is `undefined` (line 73)
- The company domain lookup block (lines 80-94) is skipped entirely
- Email sends from `PITCH CRM <signatures@pitch-crm.ai>` instead of `O'Brien Contracting <support@obriencontractingusa.com>`

### 2. Subject not using the custom text typed in the share dialog

The subject field IS being passed through correctly in the data, but when no custom subject is typed, it defaults to "Please sign: {estimate name}". If the user typed a custom subject, it does get used. However, the `documentTitle` (which becomes both the envelope title AND email subject) is being set on line 118 with the pattern `"Please sign: ..."` -- if the user expected their typed subject to override this, it should.

## Fix

### Database Migration -- Add Foreign Key

```sql
ALTER TABLE signature_envelopes
  ADD CONSTRAINT fk_signature_envelopes_tenant
  FOREIGN KEY (tenant_id) REFERENCES tenants(id);
```

This makes the PostgREST join work, so the function correctly resolves the tenant name, settings, and then finds the company email domain.

### Fallback in `email-signature-request/index.ts`

As a safety net (in case the join still returns null for edge cases), add a direct fallback query:

```typescript
// After the existing join attempt (line 64-68):
let tenantName = envelope?.tenant?.name || "PITCH CRM";
let tenantId = envelope?.tenant_id;  // <-- use the column directly, not the joined object

// If join didn't resolve tenant name, fetch directly
if (tenantName === "PITCH CRM" && tenantId) {
  const { data: tenantRow } = await supabase
    .from("tenants")
    .select("name, settings")
    .eq("id", tenantId)
    .single();
  if (tenantRow) {
    tenantName = tenantRow.name;
    tenantSettings = tenantRow.settings || {};
  }
}
```

The key fix: `tenantId` should be read from `envelope?.tenant_id` (the raw column) instead of `envelope?.tenant?.id` (the joined object). This ensures the company domain lookup runs even if the join fails.

### Files Changed

| File | Change |
|------|--------|
| Database migration | Add FK constraint on `signature_envelopes.tenant_id` to `tenants(id)` |
| `supabase/functions/email-signature-request/index.ts` | Read `tenantId` from `envelope.tenant_id` directly; add fallback tenant query; ensure company domain lookup always runs |

### Result

- Emails will come from `O'Brien Contracting <support@obriencontractingusa.com>` (the verified company domain)
- The subject line uses whatever the user typed in the share dialog, falling back to `"Please sign: {estimate name}"` only if they left it blank
- Footer says "Sent via O'Brien Contracting" instead of "PITCH CRM"
