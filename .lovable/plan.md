

# Filter Master Role from @Mention Suggestions

## Problem
The @mention dropdown in Internal Notes shows all team members including the master developer. The master role should not be taggable — only users up to "owner" level should appear.

## Fix

**File: `src/components/lead-details/InternalNotesSection.tsx`**

In the team members query (lines 118-126), add a filter to exclude users with the `master` role:

```typescript
const { data, error } = await supabase
  .from('profiles')
  .select('id, first_name, last_name, email, role')
  .eq('tenant_id', tenantId)
  .neq('role', 'master')
  .order('first_name');
```

Also filter out any `is_developer = true` profiles to be safe:

```typescript
.neq('is_developer', true)
```

This ensures the master/developer user never appears in the mention dropdown while all other roles (owner, corporate, office_admin, managers, etc.) remain taggable.

