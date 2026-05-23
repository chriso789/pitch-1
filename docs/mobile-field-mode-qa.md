# Mobile Field Mode — QA Checklist

Use this checklist whenever Live Canvassing, PropertyInfoPanel,
MobileDispositionPanel, or anything routed through
`useFieldMobileMode()` / `useIsAppFieldMode()` changes.

## Viewports to test

- iPhone SE — 375 × 667
- iPhone 15 / 16 / 17 Pro — 393 × 852
- iPad — 820 × 1180
- Desktop — 1280 × 800 (regression guard)
- Inside the PitchCRM iOS WebView (UA contains `PitchCRMApp`)

## Live Canvassing flow

1. Open `/storm-canvass/live` on each viewport.
2. GPS acquisition runs (or area centroid fallback fires).
3. Tap a property pin.
4. Mobile bottom sheet opens at ~92dvh, rounded top corners, no horizontal overflow.
5. Sticky header: owner, age badge, address, distance badge, current disposition.
6. Quick actions row: Call / Navigate / Photo / Add Customer — all `h-12+`, reachable with thumb.
7. Set disposition from horizontal chip strip; selected state obvious.
8. Run **Get Contact Info** — exactly one CTA renders when no contact exists.
9. Tap a phone — `tel:` opens; DNC numbers stay disabled with badge.
10. Tap Navigate — Apple Maps opens on iOS (native bridge), Google Maps on Android/web.
11. Tap Add Customer — contact is created / merged; toast fires.
12. Open **Field Tools** accordion — 3-col icon grid, `h-16` cells.
13. Generate Strategy — compact summary first, expand for detail.
14. Storm Reports open in modal, filter chips usable.
15. Notes section collapses by default; expanding does not push sticky actions off-screen.

## Safe-area / chrome

- Bottom recenter + canvass-mode FAB cluster floats above the home indicator.
- NavigationPanel does not sit underneath the FAB cluster or the bottom sheet handle.
- Top header controls clear the notch / Dynamic Island.
- No element uses `100vh`; all full-height containers use `100dvh`.

## Regression guard (no business logic changes)

- `storm-public-lookup`, `canvassiq-skip-trace`, `noaa-storm-reports`,
  `door-knock-strategy` still invoked with the same payloads.
- `canvassiq_properties.disposition` update + `canvassiq_visits` insert
  + `canvass_activity_log` insert all fire on disposition tap.
- Positive disposition (`interested`, `follow_up`, `callback`, `new_roof`)
  still auto-creates a contact when none exists for the property.
- Add Customer merge logic preserved (existing contact gets phones / emails
  / metadata merged rather than duplicated).
- DNC numbers remain disabled.
- Distance verification badge still shows the correct status.

## Desktop / tablet regression

- At ≥ 768px width with no PitchCRMApp UA, the original desktop sheet
  renders unchanged (same tabs, same dense layout).
- No console errors, no horizontal page overflow at any breakpoint.
