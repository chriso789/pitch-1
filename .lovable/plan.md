

# Fix: Update "Master Developer" Title and Remove Name Uniqueness Constraint

## Two Issues Found

### Issue 1: Sidebar shows "Master Developer"
The sidebar displays the profile's `title` field before falling back to the role display name. Your profile (`0a56229d`) has `title` set to `"Master Developer"` in the database. Changing the role display name to "COB" doesn't affect this -- it's a separate field.

**Fix:** Update the `title` field in the database from `"Master Developer"` to `"COB"` (or whatever you'd like shown there).

### Issue 2: Profile save fails with "Failed to update user profile"
There's a unique index `idx_unique_active_profile_per_tenant` that prevents two active users in the same tenant from having the same first + last name. You currently have:

| Profile ID | Name | Title | Active |
|-----------|------|-------|--------|
| `0a56229d` | Chris O'Brien | Master Developer | Yes |
| `248aad6c` | Chris O | Owner | Yes |

When you try to update `248aad6c` to "Chris O'Brien", the database blocks it because `0a56229d` already has that name.

**Fix:** Drop the `idx_unique_active_profile_per_tenant` index. Name-based uniqueness is wrong -- two real people can have the same name. The primary key (`id` tied to `auth.users`) is the correct uniqueness mechanism.

## Changes

### 1. New SQL Migration
Drop the overly aggressive unique constraint:
```sql
DROP INDEX IF EXISTS idx_unique_active_profile_per_tenant;
```

### 2. Update title in database
Update the `title` field on profile `0a56229d` from "Master Developer" to "COB" so the sidebar reflects the new name immediately.

### 3. No code file changes needed
The sidebar logic (`Sidebar.tsx` line 745-746) correctly shows `title` first, then falls back to `getRoleDisplayName()`. Once the database title is updated, it will display correctly.

## Files

| File | Change |
|------|--------|
| New migration SQL | `DROP INDEX IF EXISTS idx_unique_active_profile_per_tenant;` |
| Database update | Set `title = 'COB'` on profile `0a56229d` |

## After the Fix
- Sidebar will show "COB" instead of "Master Developer"
- Profile save will work without the name collision error
- You'll be able to update your name, email, and other fields normally

