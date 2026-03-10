

# Fix: "Past Customer" Status Missing From Custom Tenant Statuses

## Problem
The tenant has **custom statuses** in the `contact_statuses` table (e.g. "Old Roof - Marketing", "Storm Damage"). When custom statuses exist, the hook returns only those — the defaults (including "Past Customer") are completely ignored.

## Fix

### `src/hooks/useContactStatuses.ts`
After fetching custom statuses from the database, check if `past_customer` is already present. If not, append it to the end of the list. This ensures "Past Customer" is always available regardless of whether the tenant has custom statuses configured.

```typescript
// After mapping data (line ~51-59), before returning:
const mapped = data.map(status => ({ ... }));

// Ensure "Past Customer" is always present
if (!mapped.some(s => s.key === 'past_customer')) {
  mapped.push({
    id: 'default-past-customer',
    name: 'Past Customer',
    key: 'past_customer',
    color: '#10b981',
    description: null,
    status_order: 999,
    is_active: true,
  });
}

return mapped;
```

One file change, ensures the status shows up for all tenants.

