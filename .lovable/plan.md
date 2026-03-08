

# Fix: Jared Can't Approve in Manager Approval Queue (Roof Kings Coatings)

## Root Cause

The `api_respond_to_approval_request` database function **does not exist**. Both approval components (`ManagerApprovalQueue.tsx` and `ApprovalManager.tsx`) call `supabase.rpc('api_respond_to_approval_request', ...)` but the function was never created in the database.

Additionally, the `manager_approval_queue` table has no **UPDATE** RLS policy — only SELECT and INSERT — so even a direct update would be blocked.

## Fix

### 1. Create `api_respond_to_approval_request` database function (SQL migration)

A `SECURITY DEFINER` function that:
- Validates the caller is a manager role (corporate, owner, master, office_admin, regional_manager, sales_manager)
- Validates the caller belongs to the same tenant as the approval request
- Updates the approval record: sets `status`, `reviewed_by`, `reviewed_at`, `manager_notes`
- If approved, also transitions the pipeline entry status to `project` via a direct update
- Returns `{ success: true, clj_number }` on success

Handles both calling conventions from the two components:
- `ManagerApprovalQueue`: passes `p_approval_id`, `p_approved`, `p_manager_notes`
- `ApprovalManager`: passes `approval_id_param`, `action_param`, `manager_notes_param`

I'll standardize the function to accept one parameter set and update the component that doesn't match.

### 2. Add UPDATE RLS policy on `manager_approval_queue`

Allow managers (via `has_high_level_role`) to update approval records in their tenant.

### 3. Align component RPC call parameters

Update `ManagerApprovalQueue.tsx` to use the same parameter names as `ApprovalManager.tsx` (or vice versa) so both call the same function correctly.

## Files Modified
- **SQL migration**: Create `api_respond_to_approval_request` function + UPDATE RLS policy
- `src/features/approvals/components/ManagerApprovalQueue.tsx` — align RPC parameter names
- `src/components/ApprovalManager.tsx` — align if needed

