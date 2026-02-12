

## Plan: Pipeline Card Enhancements + Edit Button Fix

This plan addresses four items: the broken Edit button on the contact page, adding a "last activity" tooltip on the days counter badge, improving mobile UX on pipeline cards, and ensuring overall pipeline functionality.

---

### 1. Fix: Edit Button on Contact Page (Still Not Working)

**Root Cause:** The `triggerEdit` effect has `onTriggerEditConsumed` in its dependency array. Since `onTriggerEditConsumed` is an inline arrow function (`() => setTriggerEdit(false)`) that creates a new reference every render, this can cause unpredictable effect timing. Additionally, when the tab content unmounts/remounts (Radix TabsContent behavior), React's effect ordering can cause the contact-reset effect to interfere.

**Fix (two changes):**

**File: `src/pages/ContactProfile.tsx`**
- Wrap `onTriggerEditConsumed` in `useCallback` to stabilize the function reference
- Change `triggerEdit` from a boolean to a counter (number) that increments on each click -- this guarantees the effect always fires even on rapid repeated clicks

**File: `src/components/contact-profile/ContactDetailsTab.tsx`**
- Remove `onTriggerEditConsumed` from the effect dependency array (use only `triggerEdit`)
- Change the effect to respond to the counter value changing (compare with a ref) rather than checking a boolean
- This eliminates the race condition entirely

---

### 2. Add "Last Activity" Tooltip on Days Counter Badge

**File: `src/features/pipeline/components/KanbanCard.tsx`**

Wrap the days-in-status Badge (line 415-422) with a Tooltip component that shows:
- The exact date of the last action (formatted as "Jan 15, 2026 at 3:42 PM")
- A label: "Last updated: [date]"

Implementation:
- Import `Tooltip, TooltipTrigger, TooltipContent, TooltipProvider` from the existing UI components
- Format `entry.updated_at` using `date-fns` `format()` function
- Wrap the Badge in `TooltipTrigger` with the formatted date in `TooltipContent`

---

### 3. Mobile UX Improvements on Pipeline Cards

**File: `src/features/pipeline/components/KanbanCard.tsx`**

The current implementation already has good mobile support:
- Details button is `h-8 w-8` on mobile (line 504) -- already enlarged
- Communication dropdown uses `onPointerDown={(e) => e.stopPropagation()}` to avoid interfering with drag
- Details button also uses `onPointerDown` stop propagation

Minor improvements to make:
- Increase the communication dropdown trigger touch target on mobile from `h-5` to `h-8 w-8` on mobile (matching the details button pattern)
- Add `touch-action: manipulation` to the card to prevent double-tap zoom interference with drag

---

### 4. Files to Modify

| File | Changes |
|------|---------|
| `src/pages/ContactProfile.tsx` | Stabilize `triggerEdit` with counter + `useCallback` |
| `src/components/contact-profile/ContactDetailsTab.tsx` | Fix effect to use ref-based counter comparison |
| `src/features/pipeline/components/KanbanCard.tsx` | Add tooltip to days badge, improve mobile touch targets |

