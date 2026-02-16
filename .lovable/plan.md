

# Fix Duplicate Pins on Live Canvass Map

## Root Cause

The `LiveLocationMap` component renders **two independent marker layers** simultaneously:

1. `NearbyPropertiesLayer` -- queries the `contacts` table for records with lat/lng within 1 mile
2. `PropertyMarkersLayer` -- queries the `canvassiq_properties` table for records in the viewport

When a property exists in both tables (which is common after pin sync or parcel loading), two markers appear at the same address. This is why you see doubled pins like "4102", "4083", "4052" in the screenshot.

## Solution

Remove the `NearbyPropertiesLayer` from the Mapbox `LiveLocationMap`. The `PropertyMarkersLayer` already handles everything -- it loads properties, shows house numbers, color-codes by disposition, and handles click events. The `NearbyPropertiesLayer` is a legacy component that was created before `PropertyMarkersLayer` existed and is now redundant.

## Changes

### 1. Remove NearbyPropertiesLayer from LiveLocationMap
**File:** `src/components/storm-canvass/LiveLocationMap.tsx`

- Remove the `NearbyPropertiesLayer` import (line 4)
- Remove the `<NearbyPropertiesLayer>` JSX element (lines 195-199)
- Remove the `onContactSelect` prop since it was only used by `NearbyPropertiesLayer` (the `PropertyMarkersLayer` uses `onParcelSelect` instead, which routes through the same property info panel)

This is a simple deletion -- no new code needed. The `PropertyMarkersLayer` already provides all the functionality (and more) that `NearbyPropertiesLayer` was providing.

## Why This Is Safe

| Feature | NearbyPropertiesLayer | PropertyMarkersLayer |
|---------|----------------------|---------------------|
| Shows markers on map | Yes (contacts table) | Yes (canvassiq_properties table) |
| House numbers | First initial only | Full street number |
| Color-coded by status | Yes | Yes (more granular) |
| Click to open details | Yes | Yes |
| Dynamic zoom sizing | No (fixed 32px) | Yes (responsive) |
| Viewport-aware loading | No (1-mile radius only) | Yes (bounds-based) |
| Parcel auto-loading | No | Yes |

The `PropertyMarkersLayer` is strictly superior. Removing `NearbyPropertiesLayer` eliminates all duplicate pins with no loss of functionality.

