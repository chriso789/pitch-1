

## Plan: Ensure AR and Pipeline Use Only Selected Estimates (with fallback)

### Current State
Both the AR page and Pipeline already read `selected_estimate_id` from pipeline entry metadata. This is correct — only the estimate chosen for the build should count toward totals.

### Problem
Some entries may have an estimate built and visually "selected" but only have `enhanced_estimate_id` set in metadata (not `selected_estimate_id`). This happens when estimates were created before the selection logic was added. These entries show $0 in AR and Pipeline.

### Fix
Add a fallback: if `selected_estimate_id` is not set, fall back to `enhanced_estimate_id` from metadata. This matches the pattern already used in `TemplateSectionSelector.tsx` (line 113).

### Changes

**File: `src/pages/AccountsReceivable.tsx`** (line ~121)
- Change `p.metadata?.selected_estimate_id` to `p.metadata?.selected_estimate_id ?? p.metadata?.enhanced_estimate_id`

**File: `src/features/pipeline/components/Pipeline.tsx`** (line ~324)
- Change `(entry.metadata as any)?.selected_estimate_id` to `(entry.metadata as any)?.selected_estimate_id ?? (entry.metadata as any)?.enhanced_estimate_id`

Two single-line changes. No new logic — just applying the same fallback pattern already established elsewhere in the codebase.

