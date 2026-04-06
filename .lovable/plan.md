

## Fix: TrainingSessionDetail crash — "Cannot read properties of undefined (reading 'color')"

### Root Cause

Line 264: `const status = statusConfig[session.status]` — when `session.status` is a value not in `statusConfig` (e.g., `"pending"`, `"active"`, or any other status from the database), `status` becomes `undefined`, and accessing `status.color` on line 276 crashes.

### Fix

Add a fallback default to the `statusConfig` lookup on line 264:

```typescript
const status = statusConfig[session.status as keyof typeof statusConfig] 
  || { label: session.status || 'Unknown', color: 'bg-muted text-muted-foreground' };
```

This is a one-line change in `src/components/settings/TrainingSessionDetail.tsx` (line 264). No other files need modification.

