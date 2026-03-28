

## Plan: Remove "Jobs" from Sidebar & Move "Follow Up Hub" Above "Pipeline"

### Changes

**File: `src/shared/components/layout/Sidebar.tsx`**

1. **Remove "Jobs" from the `navigation` array** (lines 226-233) — delete the entire Jobs object since jobs are already accessible via the Pipeline.

2. **Move "Follow Up Hub" above Pipeline** — The Follow Up Hub is currently rendered *after* the `navigation.map()` loop (line 425+). To place it above Pipeline, move the entire Communications expandable section block (lines 425-530ish) to *before* the `navigation.map()` loop, so it renders first in the nav list.

The navigation order will become:
- Follow Up Hub (expandable)
- Pipeline
- Contacts
- Estimates
- Production
- Accounts Receivable
- Calendar
- Storm Canvas Pro
- Smart Docs
- Presentations
- Permit Expediter

Single-file change.

