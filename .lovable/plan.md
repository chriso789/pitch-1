# App Field Mode — 3-Part Pass

Scope: tighten the canvassing field UI for the iOS WebView wrapper and stand up a JS↔Swift bridge. Frontend only. No backend, RLS, or data-model changes.

---

## Part 1 — Split PropertyInfoPanel for mobile

`src/components/storm-canvass/PropertyInfoPanel.tsx` is 1478 lines. I will NOT rewrite it. Instead:

1. **Extract the current panel body into sub-sections** (no logic changes), in a new folder `src/components/storm-canvass/property-panel/`:
   - `PanelHeader.tsx` — owner, badges, address, distance/confidence
   - `QuickActionsRow.tsx` — Call · Navigate · Photo · Add Customer (sticky, 44px targets)
   - `DispositionsStrip.tsx` — sticky horizontal scroll of disposition pills
   - `PropertyIntelSection.tsx` — collapsed by default
   - `ContactLookupSection.tsx` — collapsed until tapped
   - `ToolsSection.tsx` — AI Strategy / Storm Reports / Estimate / Inspection grouped under one accordion
2. **New wrapper** `PropertyInfoPanelMobile.tsx` that composes the sections above with `Accordion` from shadcn, sticky header + actions, `pb-[env(safe-area-inset-bottom)]`, and a shorter default sheet snap (60vh) with drag-to-expand to 92vh.
3. **PropertyInfoPanel.tsx** stays as the desktop/tablet experience. At the top it branches: `if (isAppFieldMode) return <PropertyInfoPanelMobile {...props} />`.
4. Same for `MobileDispositionPanel.tsx` — add `pb-[env(safe-area-inset-bottom)]` and a 55vh collapsed snap.

Risk control: extracted sections are pure presentational chunks of the existing JSX. All handlers/state stay in the parent and are passed down.

---

## Part 2 — App-mode flag

New file `src/lib/native/appMode.ts`:

```ts
export const isNativeApp = (): boolean =>
  typeof navigator !== 'undefined' &&
  (/PitchCRMApp/i.test(navigator.userAgent) || !!(window as any).PitchNative);

export const isAppFieldMode = (): boolean => isNativeApp(); // alias for clarity
```

Hook: `useIsAppFieldMode()` returning a stable boolean.

Usage:
- PropertyInfoPanel branches to mobile layout when true.
- LiveCanvassingPage tightens paddings (`px-2` vs `px-4`) and hides desktop-only chrome when true.
- No global CSS changes — opt-in per component to avoid regressions in the browser app.

---

## Part 3 — `window.PitchNative` JS bridge

New file `src/lib/native/bridge.ts` exposing a typed API with web fallbacks. Swift side (in Xcode) implements `WKScriptMessageHandler` for each channel.

```ts
type BridgeResult<T> = { ok: true; data: T } | { ok: false; error: string };

interface PitchNativeAPI {
  openCamera(opts?: { quality?: number }): Promise<BridgeResult<{ dataUrl: string }>>;
  getLocation(): Promise<BridgeResult<{ lat: number; lng: number; accuracy: number }>>;
  openAppleMaps(lat: number, lng: number, label?: string): Promise<BridgeResult<null>>;
  storeToken(key: string, value: string): Promise<BridgeResult<null>>;
  readToken(key: string): Promise<BridgeResult<{ value: string | null }>>;
  requestPushPermission(): Promise<BridgeResult<{ granted: boolean; deviceToken?: string }>>;
  haptic(style: 'light' | 'medium' | 'heavy' | 'success' | 'error'): Promise<BridgeResult<null>>;
  share(payload: { title?: string; text?: string; url?: string }): Promise<BridgeResult<null>>;
}
```

Implementation:
- Each method posts to `window.webkit.messageHandlers.<name>.postMessage(...)` and awaits a response promise resolved by a global callback (`window.__pitchNativeResolve(id, result)`).
- If `window.webkit?.messageHandlers?.<name>` is missing → web fallback:
  - `openCamera` → hidden `<input type="file" accept="image/*" capture="environment">`
  - `getLocation` → `navigator.geolocation.getCurrentPosition`
  - `openAppleMaps` → `window.location.href = 'maps://?daddr=...'` (iOS) or `https://maps.google.com/?daddr=...`
  - `storeToken`/`readToken` → `localStorage`
  - `requestPushPermission` → web `Notification.requestPermission()`
  - `haptic` → `navigator.vibrate`
  - `share` → `navigator.share` then anchor fallback
- Exported as `nativeBridge` and also attached to `window.PitchNative` so legacy code and the Swift side can call uniformly.

Wire-in points (minimal, additive):
- LiveCanvassingPage navigation handler → `nativeBridge.openAppleMaps(...)` instead of the inline `maps://` builder.
- Photo capture button on the panel → `nativeBridge.openCamera()` when in app mode, existing flow otherwise.
- Recenter / GPS in canvass → `nativeBridge.getLocation()` (still falls back to browser geo).
- Disposition save → `nativeBridge.haptic('success')` (no-op on web).

---

## Out of scope (called out, not done)
- Swift handlers, push registration, Keychain wiring — those live in Xcode, not this repo.
- Rest of CRM (lead detail, estimate, job pages) app-mode polish — separate pass once this lands.
- Backend / RLS / schema.

## Files touched
- **New:** `src/lib/native/appMode.ts`, `src/lib/native/bridge.ts`, `src/components/storm-canvass/property-panel/{PanelHeader,QuickActionsRow,DispositionsStrip,PropertyIntelSection,ContactLookupSection,ToolsSection,PropertyInfoPanelMobile}.tsx`
- **Edited:** `PropertyInfoPanel.tsx` (top-level branch only), `MobileDispositionPanel.tsx` (safe-area + snap), `LiveCanvassingPage.tsx` (bridge wire-in + app-mode paddings)

Approve and I'll ship Part 1 → 2 → 3 in that order.
