

# Add "New Roof" as a Contact Status + Update Canvass Mapping

## Problem
When a rep sets a pin to "New Roof" in the live canvass, it maps to `qualified` as the contact status. The user wants "New Roof" to be its own distinct contact status so the contact retains that specific label.

## Changes

### 1. `src/hooks/useContactStatuses.ts`
Add "New Roof" to `DEFAULT_CONTACT_STATUSES`:
```ts
{ id: 'default-8', name: 'New Roof', key: 'new_roof', color: '#06b6d4', description: null, status_order: 8, is_active: true },
```

### 2. `src/components/storm-canvass/PropertyInfoPanel.tsx`
Update `mapDispositionToStatus` so `new_roof` maps to `new_roof` instead of `qualified`:
```ts
'new_roof': 'new_roof',  // was 'qualified'
```

### 3. `src/components/storm-canvass/NearbyPropertiesLayer.tsx`
Add cyan color for `new_roof` pins on the map:
```ts
: disposition === 'new_roof'
? '#06b6d4' // cyan
```

### 4. Database
Insert into `contact_statuses` for the tenant so it persists from DB queries.

