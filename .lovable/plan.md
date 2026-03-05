

# Show Lead Name on Pipeline Card in Contact Profile

Simple change: Line 397 in `ContactProfile.tsx` currently shows the static text "Pipeline Lead". Update it to display `entry.lead_name` when available, falling back to "Pipeline Lead" if null.

**Change in `src/pages/ContactProfile.tsx` (line 397):**
```tsx
// Before
<div className="text-sm text-muted-foreground">Pipeline Lead</div>

// After
<div className="text-sm font-medium">{entry.lead_name || 'Pipeline Lead'}</div>
```

The data is already available since the query on line 178-183 fetches `*` from `pipeline_entries`, which includes the `lead_name` column added in the previous migration.

