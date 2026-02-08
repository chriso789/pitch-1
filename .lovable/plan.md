
## Goal
Make the toggle switches in the **Preview Estimate** modal’s left panel 100% visible and clickable at all times (no clipping, no “half switches”, no being hidden behind scrollbars), across:
- Windows (thick/non-overlay scrollbars)
- macOS (overlay scrollbars)
- smaller laptop heights
- narrow viewports

## What’s happening (based on code + your screenshot)
In `src/components/estimates/EstimatePreviewPanel.tsx`, the toggle list is inside Radix `ScrollArea`.

Radix `ScrollArea` renders a custom vertical scrollbar that **overlays** the content area instead of reserving layout width like a native scrollbar. In your screenshot, the switch “thumbs” appear cut off on the right edge, which is consistent with the scrollbar/viewport overlay “stealing” a slice of horizontal space and covering the right side of each row.

Even though we added right padding (`pr-10`) to the content wrapper, the combination of:
- overlay scrollbar behavior (varies by OS/browser),
- a fixed-width left panel (`w-80`),
- and right-aligned controls (`justify-between`)
can still produce clipping in real-world viewports.

## Fix strategy (robust, “stop losing credits” approach)
### A) Remove Radix ScrollArea for the toggle list and use a native overflow container
Native scrollbars are handled by the browser/OS and won’t unpredictably overlay content in the same way, especially on Windows where scrollbar width can be large.

**Change in `src/components/estimates/EstimatePreviewPanel.tsx`:**
- Replace:
  - `<ScrollArea className="flex-1 ..."> ... </ScrollArea>`
- With:
  - a plain div like: `className="flex-1 overflow-y-auto overflow-x-hidden min-h-0"`
- Keep the sticky footer (“Reset / Share / Export”) as-is.

This makes the list scroll using native mechanics and prevents the “scrollbar covering controls” class of issues.

### B) Make each toggle row layout “unbreakable” by using CSS grid (not `justify-between`)
Even with native scrollbars, grid is more deterministic than `flex justify-between` for “label left, switch right” layouts.

**Change in `ToggleRow` (same file):**
- Replace the wrapper layout with:
  - `grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3`
- Ensure label truncates and cannot push the switch off-screen:
  - keep `min-w-0` and `truncate` on label text
- Keep `Switch` as `shrink-0` (already correct)

### C) Add a guaranteed “right safe padding” for the toggle list (small, consistent)
Instead of a big `pr-10` hack that may or may not match actual scrollbar width, use a smaller consistent padding and rely on native scrollbar reserving space.

**Change in the toggle list content wrapper:**
- Use something like:
  - `p-4 pr-4` (or `pr-5`) and keep `pb-32` for the sticky footer clearance
- This avoids wasting horizontal space while still giving breathing room.

### D) (Optional but recommended) Improve clickability + accessibility so the label toggles the switch
Right now `ToggleRow` wraps the text in a `Label`, but the `Switch` has no `id`, so clicking the label may not toggle reliably.

**Change in `ToggleRow`:**
- Generate a stable `id` for the switch (e.g., from the label or pass an explicit `id` prop)
- Set:
  - `<Label htmlFor={id}>...`
  - `<Switch id={id} ... />`
This reduces “I can’t click the tiny control” frustration and makes the whole row feel more solid.

## Files to change
1) `src/components/estimates/EstimatePreviewPanel.tsx`
- Replace Radix `ScrollArea` usage in the left panel with native overflow container
- Update the toggle list content wrapper padding
- Update `ToggleRow` layout to grid (and optionally connect Label ↔ Switch via `htmlFor`/`id`)

No other files required.

## Acceptance criteria (what “fixed” means)
1) In the Preview Estimate modal:
- Every toggle switch is fully visible (no clipping) at 100% zoom.
- Switching between Customer/Internal tabs does not change visibility.
- Scrolling the toggle list does not hide the right-side controls behind a scrollbar.

2) On smaller heights:
- Sticky footer remains visible.
- The last toggle in the list is reachable (not hidden behind the sticky footer), thanks to bottom padding.

## Verification steps (fast, end-to-end)
1) Open a lead → Estimate tab → click “Preview Estimate”.
2) In the left panel, confirm:
- you can see the full switch track and thumb for “Company Logo / Company Info / Page Header / Page Footer”.
- scroll down: switches remain fully visible throughout.
3) Test on:
- your current browser
- one other browser (Chrome + Edge or Chrome + Safari) if possible

## (Related note on your phone/SMS comment)
You mentioned your master account phone is saved. If you’re still not receiving “Quote opened” texts after the earlier `tenant_id` fix, the remaining common blockers are:
- rep phone not stored in E.164 format (`+1770...`)
- tenant/location does not have a valid outbound Telnyx “from” number provisioned/assigned
If you want, after the toggle fix we can do a quick targeted check of the SMS pipeline (rep phone formatting + outbound number resolution) without reworking UI again.
