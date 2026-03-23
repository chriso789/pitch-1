

## Plan: Sales Reps Only See Their Assigned Leads/Contacts

### Problem

When a sales rep (`project_manager`, `sales_manager`) views contacts and pipeline in another company profile (via company switcher), they currently see ALL records for that location. They should only see records assigned to them.

The estimates page already does this correctly via `canViewAllEstimates` — contacts and pipeline need the same pattern.

### Approach

Add role-based `assigned_to` filtering in the two main data views. High-level roles (`master`, `owner`, `corporate`, `office_admin`) continue to see everything. Lower roles (`regional_manager`, `sales_manager`, `project_manager`) only see records where `assigned_to = user.id` OR records they created.

### Changes

#### 1. `src/features/contacts/components/EnhancedClientList.tsx` — Contact Fetch

In `fetchData` (~line 416), after building the base contacts query with tenant and location filters, add:

```typescript
// Sales reps only see contacts assigned to them or created by them
const isLowerRole = ['project_manager', 'sales_manager', 'regional_manager'].includes(profile.role);
if (isLowerRole) {
  batchQuery = batchQuery.or(`assigned_to.eq.${user.id},created_by.eq.${user.id}`);
}
```

Also apply the same filter to pipeline entries query (~line 506):
```typescript
if (isLowerRole) {
  pipelineQuery = pipelineQuery.or(`assigned_to.eq.${user.id},created_by.eq.${user.id}`);
}
```

#### 2. `src/features/pipeline/components/Pipeline.tsx` — Pipeline Fetch

In `fetchPipelineData` (~line 238), after building the pipeline query with location/date filters, add the same role check:

```typescript
const isLowerRole = ['project_manager', 'sales_manager', 'regional_manager'].includes(currentProfile.role);
if (isLowerRole) {
  query = query.or(`assigned_to.eq.${user.id},created_by.eq.${user.id}`);
}
```

#### 3. `src/lib/roleUtils.ts` — Add Utility

Add a `canViewAllRecords` helper (consistent with existing `canViewAllEstimates`):

```typescript
export const canViewAllRecords = (role: string): boolean => {
  // office_admin (level 4) and above can see all records
  return getRoleLevel(role) <= 4;
};
```

Then use `canViewAllRecords` in the two files above instead of hardcoding the role list.

### Files to Change

1. `src/lib/roleUtils.ts` — add `canViewAllRecords`
2. `src/features/contacts/components/EnhancedClientList.tsx` — filter contacts + pipeline by `assigned_to` for lower roles
3. `src/features/pipeline/components/Pipeline.tsx` — filter pipeline entries by `assigned_to` for lower roles

### Result

- Sales reps only see leads/contacts assigned to them (or that they created)
- Admins, owners, corporate, and office admins continue to see everything
- Consistent with how estimates already work

