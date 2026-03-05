

# Fix: Lead Name Not Displaying on Contact Profile

## Problem
Two places show wrong names:

1. **Header card** (line 397): Shows "Pipeline Lead" because `lead_name` is `null` in the database for this entry. It should fall back to the contact's name (which is already available on the page), not a generic label.

2. **Pipeline tab list** (ContactJobsTab line 132): Shows "Unknown Customer" because it tries `entry.contacts?.first_name` but the pipeline entries are fetched with `select('*')` (no join), so `contacts` is undefined.

## Fix

### 1. ContactProfile.tsx header card (line 397)
Change the fallback from `'Pipeline Lead'` to use the contact's actual name:
```tsx
{(entry as any).lead_name || `${contact.first_name} ${contact.last_name}` || 'Pipeline Lead'}
```

### 2. ContactJobsTab.tsx pipeline name (line 132)
Use `entry.lead_name` first, then fall back to the contact prop (which is always available since we're on the contact profile page):
```tsx
name: entry.lead_name || `${contact.first_name || ''} ${contact.last_name || ''} - ${entry.roof_type || 'Roofing'} Lead`,
```

### Files Changed
- `src/pages/ContactProfile.tsx` -- line 397 fallback
- `src/components/contact-profile/ContactJobsTab.tsx` -- line 132 name construction

