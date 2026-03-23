

## Plan: Contact Info in Panel + Disposition Symbol Pins + Duplicate Pin Fix

### Problem Summary

1. **Contact info missing**: Phones, emails, and age are already fetched and rendered in `PropertyInfoPanel`, but only appear after skip-trace. The user wants them visible immediately when data exists (from prior enrichment or the property record itself).
2. **Disposition pins need symbols**: Currently pins are colored circles with house numbers. User wants house number + a small disposition symbol badge (e.g., checkmark for Interested, X for Not Interested, house for Not Home).
3. **Symbol settings without leaving live canvass**: Need an in-map settings drawer to customize which symbol maps to which disposition.
4. **Double pins persist**: The deduplication logic uses `normalizeAddressKeyClient` but the issue is that `reconcileMarkers` only removes keys NOT in the current load — it never clears old markers from a *previous* load version that had overlapping keys computed slightly differently. Two loads can produce the same address with different normalized keys (e.g., one from `normalized_address_key` column, another from address JSON parsing), leaving both markers alive.

---

### Fix 1: Eliminate Remaining Duplicate Pins

**File: `src/components/storm-canvass/GooglePropertyMarkersLayer.tsx`**

Root cause: `getNormalizedAddressKey` re-normalizes the `normalized_address_key` column through `normalizeAddressKeyClient`, but when parsing from JSON it can produce a slightly different key (different field used, extra whitespace). Two DB rows for the same address produce different canonical keys.

Changes:
- In `getNormalizedAddressKey`: when `property.normalized_address_key` exists, use it **directly** (lowercase + underscore-replace only) without re-running it through `normalizeAddressKeyClient`. The server already normalized it.
- Add a secondary dedup pass in `deduplicateProperties`: extract just the house number + street name core from each key, and if two keys share the same house-number prefix, keep only the one with `building_snapped=true` or newest.
- In `reconcileMarkers`: before adding new markers, clear ALL existing markers (full `clearAllMarkers()`) then re-add from the deduplicated set. This is a small perf cost but eliminates any possibility of orphaned keys from key-mismatch across loads.

### Fix 2: Show Contact Info Immediately in Bottom Sheet

**File: `src/components/storm-canvass/PropertyInfoPanel.tsx`**

The panel already has full phone/email/age rendering (lines 919-980). The issue is the conditional at line 896 that hides the "Get Contact Info" CTA only when `publicLookupDoneRef.current === property.id`. When property data already has `phone_numbers` or `emails` from the DB (prior enrichment), these should render immediately.

Changes:
- Move the phone/email display section (lines 919-980) ABOVE the "Select Home Owner" section so contact info is visible first
- Show phone_numbers and emails from the raw `property` prop immediately on open (before `localProperty` enrichment completes), falling back to `localProperty` data when available
- Display owner age from `displayOwners[0]?.age` prominently next to owner name in the header area
- Always show the contact info section; show "Get Contact Info" button only when no phones AND no emails exist

### Fix 3: Disposition Symbol Badges on Map Pins

**File: `src/components/storm-canvass/GooglePropertyMarkersLayer.tsx`**

Update `createMarkerIcon` to render a small symbol badge in the bottom-right corner of each pin when a disposition is set:

- Define a `DISPOSITION_SYMBOLS` map: `{ interested: '$', not_interested: '✕', not_home: '⌂', follow_up: '↻', new_roof: '✓', unqualified: '✕', not_contacted: '', old_roof_marker: '△', past_customer: '★' }`
- In the SVG, after the house number text, add a small colored circle (8px) at bottom-right with the symbol character inside (6px font)
- The circle background uses the disposition color; the symbol is white
- At zoom < 17 (when house number is hidden), make the symbol the primary content of the pin instead

### Fix 4: In-Map Symbol Settings Drawer

**New file: `src/components/storm-canvass/MapSymbolSettings.tsx`**

A small drawer/popover accessible from the existing map controls area (next to MapStyleToggle):
- Settings gear icon button in the floating controls bar
- Opens a Sheet from the right side
- Lists each disposition with its current color swatch + symbol
- Each row has a dropdown to pick from ~10 symbol options (✓, ✕, $, ⌂, ↻, △, ★, ●, ♦, !)
- Settings stored in localStorage per tenant (key: `canvass_symbol_settings_{tenant_id}`)
- Default symbols used when no custom settings exist
- No need to leave the live canvass window

**File: `src/pages/storm-canvass/LiveCanvassingPage.tsx`**
- Add the settings button to the floating controls area
- Pass symbol settings down to `GoogleLiveLocationMap` → `GooglePropertyMarkersLayer`

---

### Files to Change

1. `src/components/storm-canvass/GooglePropertyMarkersLayer.tsx` — fix dedup, add symbol badges to SVG markers, accept symbol settings prop
2. `src/components/storm-canvass/GoogleLiveLocationMap.tsx` — pass symbol settings prop through
3. `src/components/storm-canvass/PropertyInfoPanel.tsx` — reorder contact info above owner selection, show immediately
4. `src/components/storm-canvass/MapSymbolSettings.tsx` — new component for in-map symbol configuration
5. `src/pages/storm-canvass/LiveCanvassingPage.tsx` — add settings button + state, pass symbol config down

### Expected Result

- One pin per address (no duplicates)
- Each pin shows house number + small disposition symbol badge
- Contact info (phones, emails, age) visible immediately in bottom sheet
- In-map settings drawer for customizing disposition symbols
- No need to leave the live canvass window for any of this

