
Goal
- Make the “Preview Estimate” action always visible so you never have to hunt/scroll for it again (especially in the Estimate tab flow on `/lead/:id?tab=estimate`).
- Also ensure the action buttons inside the Preview Estimate modal (Reset / Share / Export) cannot be pushed off-screen on shorter viewports.

What I found in the code (current behavior)
1) The “Preview” button you click from the Lead → Estimate tab lives in:
- `src/components/estimates/MultiTemplateSelector.tsx` (around lines ~2095–2164)
- It is rendered as part of a normal “Action Buttons” section in the page flow:
  - This means it scrolls away as you work further down the estimate, which matches the repeated “can’t find it” pain.

2) Inside the Preview Estimate modal:
- `src/components/estimates/EstimatePreviewPanel.tsx`
- The footer buttons are in a “Bottom Actions” block (lines ~579–619) in the left panel.
- They are currently outside the ScrollArea (good), but on shorter heights they can still feel “not always visible” depending on viewport and internal layout constraints.

Proposed solution (make it impossible to miss)
A) Add a persistent, always-visible “Preview Estimate” floating button while editing an estimate (Lead → Estimate tab)
File: `src/components/estimates/MultiTemplateSelector.tsx`

Implementation approach
- Add a floating action button (FAB) that is `position: fixed` (not sticky) so it is always visible regardless of scroll position.
- Show it only when it actually makes sense:
  - `shouldShowTemplateContent && lineItems.length > 0`
  - and only when the preview modal is not already open (`!showPreviewPanel`)
- Clicking it will do the exact same thing as your existing Preview button:
  - `setShowPreviewPanel(true)`

UI details
- Desktop/tablet: bottom-right floating button (high visibility, minimal layout disruption).
- Mobile: same button, but larger touch target and raised above safe area.
- Add a subtle shadow + primary styling so it is unmissable.

Layout/safety
- Because it’s fixed, it won’t disappear. To avoid blocking important content, I’ll:
  - keep it in the bottom-right corner (instead of a full-width bar)
  - add safe-area spacing for iOS (`bottom-[calc(1rem+env(safe-area-inset-bottom))]` pattern)

Optional (recommended)
- Keep your existing inline action buttons where they are (Save Selection / Preview / Export / Create Estimate), but the new floating “Preview Estimate” becomes the always-available shortcut.

B) Make the Preview Estimate modal footer actions “always visible” (never clipped)
File: `src/components/estimates/EstimatePreviewPanel.tsx`

Implementation approach
- Turn the Bottom Actions area into a pinned/sticky footer within the left panel so it cannot be pushed out of view:
  - Add `sticky bottom-0 z-20`
  - Add `bg-muted/30 backdrop-blur border-t`
  - Add safe-area padding on the bottom for mobile
  - Add `pointer-events-auto` / `relative` to prevent any overlay/scrollbar click interception edge cases
- Add bottom padding to the ScrollArea content wrapper so the last toggles don’t end up hidden behind the sticky footer:
  - current inner wrapper: `className="box-border w-full p-4 pr-10 space-y-4"`
  - update to include something like `pb-28` (exact value tuned to footer height)

Why both A + B
- A guarantees the “Preview Estimate” action is always visible on the Lead → Estimate screen (where you’re likely losing it repeatedly).
- B guarantees the modal’s key actions (Reset / Share / Export) are always visible once you’re inside Preview (so you don’t have to scroll around inside the left panel to find “Share/Export”).

Verification checklist (so we don’t burn more credits on repeats)
1) Lead → Estimate tab
- Scroll anywhere on the estimate screen: confirm a “Preview Estimate” floating button is always visible.
- Click it: Preview modal opens every time.

2) Preview Estimate modal
- On a short viewport (small laptop window height) and on mobile:
  - Reset / Share / Export are visible without scrolling.
  - Toggle list can scroll behind the footer without hiding controls permanently.

3) Regression checks
- Confirm the existing inline action buttons still work (Save Selection, Export PDF, Create Estimate).
- Confirm the floating button does not appear when the modal is open.

Files to change
- `src/components/estimates/MultiTemplateSelector.tsx`
  - Add fixed floating “Preview Estimate” button (conditional render)
- `src/components/estimates/EstimatePreviewPanel.tsx`
  - Make footer sticky/pinned and add ScrollArea bottom padding so content doesn’t hide behind it

Notes / edge cases
- If your LeadDetails page (or a parent container) ever uses a transform on a wrapping element, it can affect fixed positioning. If that happens, I’ll switch the FAB to render via a portal to `document.body` (still fully within React, no library needed).
- If you also want “Export PDF” always visible, we can include a second small button next to the floating Preview, but I’ll start with just Preview since that’s the main pain point you called out repeatedly.
