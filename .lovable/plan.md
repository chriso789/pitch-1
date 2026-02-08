
Goal
- Restore “Preview Estimate” modal usability:
  1) Toggle switches (and other right-aligned controls) must be fully visible (not clipped).
  2) “Share” button must be enabled when sharing is actually possible (e.g., when we have an estimateId OR a pipelineEntryId fallback).

What’s happening (root causes)
1) Toggles/buttons are getting visually clipped on the right
- In `EstimatePreviewPanel.tsx`, the ScrollArea content wrapper is:
  - `w-full` plus padding (`p-4 pr-5`)
- In CSS, `width: 100%` applies to the content box. Padding is added on top of that, making the element’s total rendered width exceed the viewport.
- Result: the right-most content (Switches) overflows beyond the ScrollArea viewport and gets cut off, and/or sits under the ScrollArea scrollbar.

2) “Share” is greyed out and not clickable
- In `EstimatePreviewPanel.tsx` the Share button is disabled when `!estimateId`:
  - `disabled={!estimateId}`
- But `ShareEstimateDialog` already supports a fallback flow using `pipelineEntryId` to find the estimate in the edge function (`send-quote-email`), so disabling purely on `estimateId` is too strict.
- In your lead flow (`/lead/...?...tab=estimate`), it’s common to have `pipelineEntryId` available even if `estimateId` is undefined in the UI state.

Files I will inspect/adjust
- `src/components/estimates/EstimatePreviewPanel.tsx` (main fixes)
- (Verify only) `src/components/estimates/MultiTemplateSelector.tsx` (ensure `pipelineEntryId` is being passed; it is)

Implementation plan (code changes)
A) Fix the clipped toggles/switches (layout)
1. Update the ScrollArea inner content wrapper to use border-box sizing so padding does not increase total width:
   - Add Tailwind `box-border`
   - Keep `w-full` (now safe), and adjust right padding to account for scrollbar + switch width
2. Remove any unnecessary `max-w-full` (often redundant once `box-border` is used) and ensure the wrapper does not force overflow.
3. Make the right-aligned switch container consistently visible:
   - Keep `Switch` as `shrink-0`
   - Ensure the row container does not overflow: `min-w-0` already on Label; we’ll also ensure the row wrapper isn’t inadvertently wider than its parent.

Concrete change (high level)
- Change:
  - `className="p-4 pr-5 space-y-4 w-full max-w-full"`
- To something like:
  - `className="box-border w-full p-4 pr-10 space-y-4"`
  (The exact `pr-*` may be tuned; `pr-10` is a safe starting point so the scrollbar never covers the switches.)

B) Fix “Share” being disabled incorrectly
1. Change Share button disabled logic from:
   - `disabled={!estimateId}`
   to:
   - `disabled={!(estimateId || pipelineEntryId)}`
2. Update the tooltip/title copy to reflect both possibilities:
   - If neither exists: “Save the estimate first to share”
   - If pipelineEntryId exists (even without estimateId): “Share via email”
3. Keep the existing `ShareEstimateDialog` invocation as-is (it already passes `estimateId` and `pipelineEntryId`), ensuring the edge function can use whichever is present.

C) Guard against “buttons not clickable” regressions (pointer-events/overlays)
Even though the screenshot mostly shows a disabled Share (expected with current logic), we’ll also prevent accidental overlay/click issues:
1. Confirm the left panel bottom actions are not covered by the ScrollArea scrollbar by ensuring:
   - Bottom actions container stays outside ScrollArea (already true)
   - No absolute overlays exist inside the dialog
2. If we still see click issues after A+B, we’ll add a targeted fix:
   - Ensure bottom actions container has `relative z-10 pointer-events-auto`
   This is a safe “belt and suspenders” if a scrollbar/overlay is intercepting clicks in some browsers.

Verification checklist (what you will test after I implement)
1) Toggle visibility
- Open a lead → Estimate tab → “Preview Estimate”
- Confirm every switch is fully visible (thumb + track), not clipped.
- Scroll the left panel and ensure switches remain visible in all sections.
- Test at:
  - Narrow window
  - Normal desktop width
  - If you use it: mobile viewport

2) Share button behavior
- Case A: estimateId exists → Share enabled
- Case B: estimateId missing but pipelineEntryId exists → Share enabled
- Case C: both missing → Share disabled with “Save first” tooltip
- Click Share and confirm the Share dialog opens and accepts inputs.

3) No UI regressions
- Export PDF still works
- No new horizontal scrolling inside the left panel
- Scrollbar does not overlap controls

If the Share dialog opens but sending fails
- Next step will be to check the edge function `send-quote-email` logs and confirm it properly resolves an estimate from `pipeline_entry_id` (this is backend-side behavior and separate from the UI enable/disable issue).

Notes for you (plain-English)
- The toggles are being cut off because the content area is effectively “wider than the sidebar” due to how padding + `w-full` interact.
- The Share button is grey because the UI currently requires a specific ID (`estimateId`), but your system already supports sharing via the pipeline record too—so we’ll enable it when either ID exists.
