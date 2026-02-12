

## Fix Pipeline Card Issues: Dropdown, Day Counter, and Mobile Button

### Issue 1: Status Dropdown Empty on Lead Details Page

**Root cause:** The Lead Details page imports the static `LEAD_STAGES` from `usePipelineData`, which contains default stage keys (`new_lead`, `contacted`, `qualified`, etc.). But the actual pipeline entries use the real database keys (`lead`, `contingency_signed`, `legal_review`, etc.). When the dropdown filters stages by `getAvailableStatuses()`, none match because the stage keys are completely different.

**Fix:** Replace the static `LEAD_STAGES` import with the dynamic `usePipelineStages()` hook, which fetches the real stages from the database. Update both the dropdown options and the status badge display to use the dynamic stages.

### Issue 2: Day Counter Shows Age, Not Last Activity

**Root cause:** The `getDaysInStatus()` function in `KanbanCard.tsx` calculates days since `created_at` (when the pipeline entry was first created). The user wants it to show days since the last action/activity in the system. The card already has `daysSinceLastComm` which tracks last communication -- the "days in status" badge should use `updated_at` instead of `created_at` to reflect the last time there was any action.

**Fix:** Change `getDaysInStatus()` to use the pipeline entry's `updated_at` field instead of `created_at`. This requires:
- Adding `updated_at` to the pipeline entry type and query in `usePipelineData.ts`
- Updating the calculation in `KanbanCard.tsx` to use `updated_at`

### Issue 3: Details Button Too Small and Invisible on Mobile

**Root cause:** The "View Details" arrow button is:
- Only 14x14px (`h-3.5 w-3.5`) -- far below the 44x44px touch target minimum
- Hidden by default (`opacity-0`) and only appears on hover (`group-hover:opacity-100`), which doesn't trigger on mobile touch devices
- Positioned at the absolute bottom-left corner with no padding

**Fix:** Make the button always visible on mobile, increase touch target size, and make the entire card tappable to navigate to details (instead of relying on the tiny arrow). Specifically:
- Change the card's `onClick` (`handleCardClick`) to navigate to the lead details page directly
- Make the arrow button always visible (not just on hover) with a larger touch target on mobile
- Keep the drag handle and other interactions working via pointer event handling

---

### Technical Details

| File | Change |
|------|--------|
| `src/pages/LeadDetails.tsx` | Replace `LEAD_STAGES` import with `usePipelineStages()` hook; update dropdown and status badge to use dynamic stages |
| `src/features/pipeline/components/KanbanCard.tsx` | Change `getDaysInStatus()` to use `updated_at`; make details button always visible and larger on mobile; make card tap navigate to details |
| `src/hooks/usePipelineData.ts` | Add `updated_at` to `PipelineEntry` interface and to the query select |

**LeadDetails.tsx changes:**
- Remove: `import { LEAD_STAGES } from '@/hooks/usePipelineData'`
- Add: `import { usePipelineStages } from '@/hooks/usePipelineStages'`
- Add inside component: `const { stages } = usePipelineStages();`
- Replace all references to `LEAD_STAGES` with `stages`
- The `getAvailableStatuses` and `allStages` variables should also derive from the dynamic stages instead of hardcoded arrays

**KanbanCard.tsx changes:**
- Accept `updated_at` in the entry prop interface
- Change `getDaysInStatus` to: `new Date(entry.updated_at || entry.created_at)`
- Change the details button from `opacity-0 group-hover:opacity-100 h-3.5 w-3.5` to `opacity-100 h-8 w-8 md:h-6 md:w-6` so it's always visible and has a proper touch target
- Make `handleCardClick` navigate to lead details instead of calling `onView`

**usePipelineData.ts changes:**
- Add `updated_at` to the select query and `PipelineEntry` interface

