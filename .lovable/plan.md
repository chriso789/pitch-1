

# Fix Overlapping Same-Number Pins on Corner Properties

## Root Cause

There are NO actual duplicate records in the database. The "duplicates" you see are **different properties on different streets** that share the same house number because they're at street intersections (corner lots):

- "4102 Cherokee Street" and "4102 Fonsica Avenue" (lat difference: 0.0001)
- "4052 Cherokee Street" and "4052 Fonsica Avenue"
- "4083 Cherokee Street" and "4083 Fonsica Avenue"

Since the marker only displays the house number (e.g., "4102"), two nearby pins with the same number look like duplicates -- but they aren't.

## Solution

Show the **street name** alongside the house number inside (or below) each marker so you can distinguish "4102 Cherokee" from "4102 Fonsica". Additionally, add client-side deduplication/clustering for pins that are extremely close together (within ~10 meters) to prevent visual overlap.

## Changes

### 1. Show Street Name on Markers
**File:** `src/components/storm-canvass/PropertyMarkersLayer.tsx`

- Update `getStreetNumber()` to also return a short street name (e.g., "Cherokee" from "Cherokee Street")
- At zoom 17+, display the street name as a small label below the circle marker (using a container div with the circle on top and a text label below)
- At zoom 15-16, keep showing just the house number (not enough space for street name)
- This makes "4102 Cherokee" visually distinct from "4102 Fonsica"

### 2. Cluster Nearby Same-Number Pins
**File:** `src/components/storm-canvass/PropertyMarkersLayer.tsx`

- Before rendering markers, group properties that are within ~15 meters of each other AND share the same street number
- For clustered groups, offset the markers slightly (stagger by a few pixels) so they don't perfectly overlap
- This ensures both pins are always visible and tappable even at lower zoom levels

## Technical Details

| Change | File | Description |
|--------|------|-------------|
| Street name extraction | `PropertyMarkersLayer.tsx` | Parse street name from `address.street_name`, strip suffix (St/Ave/Dr), show abbreviated |
| Label layout | `PropertyMarkersLayer.tsx` | At zoom 17+: div container with circle + text label below; at 15-16: number only |
| Overlap offset | `PropertyMarkersLayer.tsx` | Detect pins within 15m with same number, offset by 8px left/right |

