
## What’s happening (root cause)

The edge function `send-quote-email` is currently trying to find the estimate like this:

- It derives `tenantId` from the **sender’s profile**: `profile.active_tenant_id || profile.tenant_id`
- Then it queries `enhanced_estimates` with **both**:
  - `.eq('id', estimate_id)` (or `.eq('pipeline_entry_id', ...)`)
  - `.eq('tenant_id', tenantId)`

If the user is a multi-company user (company switcher) or “master” user, it’s very common for:
- the estimate to belong to **Company B**, while
- `profile.active_tenant_id` is **null** or still pointing to **Company A** (or the “home” tenant)

In that case, the estimate lookup becomes:
- “Find estimate X in tenant A”
- but estimate X is in tenant B
- result: **404 Estimate not found** even though it exists.

This also explains why your UI can show an estimate/preview but the email function says it can’t find it.

A second issue in the current edge function code:
- It joins tenant branding via `tenants:tenant_id(...)` based on the **profile tenant**, which can be the wrong company if the estimate is in another tenant. Even after we fix the estimate lookup, branding could still be wrong unless we also fetch tenant info by the **estimate’s tenant**.

## Goal

Make “Send Quote” always:
1) attach/email the correct estimate, and  
2) use the correct company (tenant) context for branding + outbound domain,  
even when the user has switched companies.

## Implementation approach

### A) Frontend: send the effective tenant id (best-effort hint)
Update the UI invocation to pass the currently selected company (effective tenant) so the backend has an explicit hint.

- File: `src/components/estimates/ShareEstimateDialog.tsx`
- Add `tenant_id` to the payload using the existing multi-tenant hook:
  - `useEffectiveTenantId()`

This won’t be the security source of truth, but it improves correctness and makes debugging clearer.

### B) Edge Function: stop filtering by “profile tenant”; resolve tenant from the estimate itself
Update `supabase/functions/send-quote-email/index.ts` to:

1. **Authenticate user** (keep current JWT flow).
2. Parse request body and accept optional `tenant_id` (from frontend).
3. **Look up the estimate WITHOUT tenant filtering first**, using service role:
   - If `estimate_id` present:
     - `select ... from enhanced_estimates where id = estimate_id`
   - Else if `pipeline_entry_id` present:
     - `select ... from enhanced_estimates where pipeline_entry_id = ... order by created_at desc limit 1`
4. If estimate not found -> 404 “Estimate not found” (true missing).
5. If found:
   - Set `resolvedTenantId = estimate.tenant_id`
6. **Verify the user is allowed to operate on that tenant**
   - Use the existing pattern from other hardened functions:
     - Check membership via `profiles` (home/active tenant) OR `user_company_access`
   - If not a member -> return **403** (not 404) with a clear message like:
     - “You don’t have access to this estimate’s company. Switch companies and try again.”
7. From here onward, use `resolvedTenantId` for:
   - `company_email_domains` lookup
   - `quote_tracking_links.tenant_id`
   - `communication_history.tenant_id`
   - tenant branding (logo/colors/name)
8. Fix branding lookup:
   - Don’t rely on `tenants:tenant_id(...)` join from the sender profile.
   - Instead query `tenants` table directly with `resolvedTenantId`.

### C) Make the error message accurate (so you don’t get misled)
Adjust failure messaging so:
- 404 is only for “no estimate exists for that id / pipeline entry”
- 403 is for “estimate exists but belongs to a different tenant you’re not authorized for”
- optionally 409 for “company mismatch” (if you want a distinct “switch company” response)

### D) Add minimal “diagnostic logs” that will actually help
Keep logs but make them actionable and safe:
- Log IDs and tenant IDs (no emails/phones)
- Example:
  - request: estimate_id, pipeline_entry_id, body.tenant_id
  - lookup result: estimate.id, estimate.tenant_id
  - membership check: pass/fail

This will let us prove it’s a tenant-resolution issue immediately.

## Files that will change

1) **Frontend**
- `src/components/estimates/ShareEstimateDialog.tsx`
  - Add `tenant_id: effectiveTenantId` to the invoke body

2) **Backend**
- `supabase/functions/send-quote-email/index.ts`
  - Resolve estimate first (no tenant filter)
  - Use estimate.tenant_id as the tenant source of truth
  - Verify membership
  - Fetch tenant branding by resolvedTenantId
  - Use resolvedTenantId everywhere in inserts/lookups
  - Improve status codes/messages

## Step-by-step verification plan (after implementation)

1. Reproduce in Preview (test env):
   - Open an estimate while switched to a non-home company
   - Click Share → Send Quote
2. Confirm edge function logs show:
   - estimate found by id
   - resolvedTenantId matches estimate row
   - membership check passed
3. Confirm email “From” domain + name match the correct company settings.
4. Confirm `quote_tracking_links` row created with the correct `tenant_id` and `estimate_id`.
5. Open the customer link and confirm view tracking still works.

## Notes about why logs weren’t showing in our tool earlier
Your screenshot error could be coming from the **Published (Live)** app while we’re checking **Test** logs. After we fix this in Test, you’ll either:
- test in Preview URL, or
- publish to Live once confirmed working.

(We’ll validate by checking which hostname is calling the function and by re-testing after deploying.)

## Edge cases handled by this plan

- Company switcher set to a tenant that isn’t reflected in `profiles.active_tenant_id`
- “Master” user with multiple tenant access
- estimate_id missing but pipeline_entry_id present
- correct branding/outbound domain per tenant
