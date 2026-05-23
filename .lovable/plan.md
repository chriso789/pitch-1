# Mobile Field Mode — Live Canvassing Refactor

Builds on what's already shipped (`src/lib/native/appMode.ts`, `src/lib/native/bridge.ts`, basic safe-area on PropertyInfoPanel / MobileDispositionPanel, Apple Maps bridge wire-in in LiveCanvassingPage). This plan covers the full structural refactor requested.

Frontend only. No schema, RLS, or edge-function changes. No business logic changes — only JSX reorganization and class tweaks.

---

## 1. Layout helper

**New:** `src/hooks/useFieldMobileMode.ts`
- Re-exports / composes existing pieces:
  - `isMobileViewport` from `useIsMobile()` (already exists at `src/hooks/use-mobile.tsx`)
  - `isNativeApp` from `src/lib/native/appMode.ts` (already exists)
- Exports `useFieldMobileMode(): { isMobileViewport, isNativeApp, isFieldMobileMode }`
- `isFieldMobileMode = isMobileViewport || isNativeApp`

**Alias:** `src/utils/nativeBridge.ts` — re-export wrapper around existing `src/lib/native/bridge.ts` exposing the exact function names the user asked for (`isPitchNativeApp`, `openNativeCamera`, `requestNativeLocation`, `openNativeMaps`, `storeNativeToken`, `requestPushPermission`, `haptic`). Thin shim so callers can use either path.

---

## 2. PropertyInfoPanel — modular mobile layout

**File:** `src/components/storm-canvass/PropertyInfoPanel.tsx` (1,496 lines)

Approach: keep the existing component as the single source of state/handlers (all `useState`, `useRef`, `useCallback`, Supabase calls stay put). Extract presentational sections into co-located sub-components under `src/components/storm-canvass/property-panel/` that receive props. Then render either the desktop tree (existing) or the mobile tree (new composition) based on `isFieldMobileMode`.

**New sub-components** (`src/components/storm-canvass/property-panel/`):
- `MobilePanelHeader.tsx` — owner, age badge, address, distance verification badge, current disposition badge, small confidence badge. Sticky `top-0 z-10 bg-background border-b`.
- `MobileQuickActions.tsx` — 4-icon row (Call / Navigate / Photo / Add Customer), `h-12` minimum, `+ More` overflow popover for less-common actions. Sticky under header.
- `MobileDispositionStrip.tsx` — horizontal scroll chips, `h-11`, readable label, obvious selected state. Uses the same `DISPOSITIONS` array + `handleDisposition` handler from parent.
- `MobileContactInfo.tsx` — first 2 phones + first 1 email visible; "Show all contact info" expander. DNC numbers disabled + marked. `tel:` / `mailto:` via existing handlers. If no contact: single "Get Contact Info" CTA (de-duplicated — removed from elsewhere on mobile).
- `MobilePropertyIntel.tsx` — Accordion (collapsed default): APN, sqft, year built, homestead, assessed value, sources + confidence.
- `MobileFieldTools.tsx` — Collapsible (collapsed default): 3-col icon grid, `h-16` cells — Storm, Google Sun, Directions, Fast Estimate, Add Photo, Strategy, Inspection.
- `MobileAIPanels.tsx` — Collapsibles for AI Strategy (compact summary first, "View Details" expand), Storm Reports list, Score "Why" panel.
- `MobileNotesSection.tsx` — collapsed when empty; full-width readable textarea when expanded; never pushes sticky actions off screen.

**Wrapper composition:** in `PropertyInfoPanel.tsx` after all state/handlers, branch:

```tsx
if (isFieldMobileMode) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="h-[92dvh] max-h-[92dvh] rounded-t-3xl overflow-hidden p-0 flex flex-col"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <MobilePanelHeader ... />
        <MobileQuickActions ... />
        <div className="flex-1 overflow-y-auto overscroll-contain px-3 pb-4"
             style={{ WebkitOverflowScrolling: 'touch' }}>
          <MobileDispositionStrip ... />
          <MobileContactInfo ... />
          <MobilePropertyIntel ... />
          <MobileFieldTools ... />
          <MobileAIPanels ... />
          <MobileNotesSection ... />
        </div>
        {/* existing dialogs (FastEstimate, PhotoCapture, Inspection, StormScoreWhy) stay rendered below */}
      </SheetContent>
    </Sheet>
  );
}
// existing desktop JSX unchanged below
```

Risk control: zero changes to handlers, refs, effects, or Supabase calls — only JSX rearrangement. Desktop tree is preserved 1:1.

---

## 3. MobileDispositionPanel polish

**File:** `src/components/storm-canvass/MobileDispositionPanel.tsx`
- Switch container to `max-h-[90dvh]` (already at 70vh; widen).
- Sticky `SheetHeader` with `top-0 bg-background z-10`.
- Disposition buttons → `h-12` minimum.
- Notes section collapsed by default (already toggles; keep).
- "Navigate Here" routes through `nativeBridge.openNativeMaps(...)`.
- `overflow-y-auto` + `WebkitOverflowScrolling: 'touch'` (partly there; harden).
- Keep `paddingBottom: env(safe-area-inset-bottom, 0px)` already in place.

---

## 4. LiveCanvassingPage iOS-safe polish

**File:** `src/pages/storm-canvass/LiveCanvassingPage.tsx`
- Replace any `h-screen`/`100vh` with `100dvh` (page root already uses `h-[100dvh]`; audit children).
- Top control bar: ensure `paddingTop: env(safe-area-inset-top, 0px)` (already on root; verify FAB/search bar).
- Bottom recenter / canvass-mode FAB cluster: add `paddingBottom: calc(env(safe-area-inset-bottom, 0px) + 12px)` to its container so it floats above the home indicator.
- NavigationPanel: bottom offset bumped by safe-area so it doesn't sit under PropertyInfoPanel sheet drag handle.
- No changes to: `GoogleLiveLocationMap`, GPS acquisition, route calculation, address search, drop pin, offline photo sync, map style toggle, panel open/close, disposition.

---

## 5. Native bridge shim

**New:** `src/utils/nativeBridge.ts` — re-exports from `src/lib/native/bridge.ts` with the exact names from the spec:

```ts
export { isNativeApp as isPitchNativeApp } from '@/lib/native/appMode';
export const openNativeCamera = (p?) => nativeBridge.openCamera(p);
export const requestNativeLocation = () => nativeBridge.getLocation();
export const openNativeMaps = (lat, lng, label?) => nativeBridge.openAppleMaps(lat, lng, label);
export const storeNativeToken = (t: string) => nativeBridge.storeToken('auth', t);
export const requestPushPermission = () => nativeBridge.requestPushPermission();
export const haptic = (t?) => nativeBridge.haptic(t ?? 'light');
```

All already implemented with safe web fallbacks in `bridge.ts`. Wire-in points:
- `MobileQuickActions` Photo → `openNativeCamera()`; on failure/no native, fall through to existing `setShowPhotoCapture(true)`.
- `MobileQuickActions` Navigate → `openNativeMaps(lat, lng, address)`; existing `onNavigate` prop still called for route-line state.
- `handleDisposition` (parent) → `haptic('success')` after successful Supabase update (no-op in browser).

---

## 6 / 7. Backend + business logic untouched

No changes to schema, RLS, or edge functions. No changes to:
`storm-public-lookup`, `canvassiq-skip-trace`, `noaa-storm-reports`, `door-knock-strategy`, public lookup auto-run, skip trace, owner enrichment, DNC protection, disposition update, visit logging, `canvass_activity_log` insert, auto-create contact on positive dispositions, add-customer merge, storm reports, fast estimate, inspection/photo, distance verification.

---

## 8. QA doc

**New:** `docs/mobile-field-mode-qa.md` — viewport checklist (iPhone SE / 15-17 Pro / iPad / desktop), Live Canvassing flow checklist (select pin → disposition → get contact → call → navigate → add customer → photo → tools → strategy), safe-area / home indicator / notch checks, no horizontal overflow check.

---

## Files

**New (9):**
- `src/hooks/useFieldMobileMode.ts`
- `src/utils/nativeBridge.ts`
- `src/components/storm-canvass/property-panel/MobilePanelHeader.tsx`
- `src/components/storm-canvass/property-panel/MobileQuickActions.tsx`
- `src/components/storm-canvass/property-panel/MobileDispositionStrip.tsx`
- `src/components/storm-canvass/property-panel/MobileContactInfo.tsx`
- `src/components/storm-canvass/property-panel/MobilePropertyIntel.tsx`
- `src/components/storm-canvass/property-panel/MobileFieldTools.tsx`
- `src/components/storm-canvass/property-panel/MobileAIPanels.tsx`
- `src/components/storm-canvass/property-panel/MobileNotesSection.tsx`
- `docs/mobile-field-mode-qa.md`

**Edited (3):**
- `src/components/storm-canvass/PropertyInfoPanel.tsx` — add mobile branch; desktop tree untouched.
- `src/components/storm-canvass/MobileDispositionPanel.tsx` — sticky header, `h-12` buttons, native maps wire-in.
- `src/pages/storm-canvass/LiveCanvassingPage.tsx` — safe-area on FAB cluster + NavigationPanel; `100dvh` audit.

## Acceptance

Map-first canvass preserved · property details no longer cramped on iPhone · thumb-reachable actions · no duplicate "Get Contact Info" CTAs · no horizontal overflow · no Supabase regressions · no desktop regressions · native bridge safe in browser · build passes.

## Out of scope

Swift handlers (Xcode side). Lead detail page / estimate / job page polish — separate pass once canvass lands.
