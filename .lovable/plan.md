## Problem

The pipeline stage header dollar amount (e.g. "Legal Review — $79,143") doesn't reliably reflect the **saved estimate selling_price** for the leads in that column.

Two pipeline UIs render the column header total, and they diverge:

| File | Current total source | Issue |
|------|----------------------|-------|
| `src/features/pipeline/components/Pipeline.tsx` (main `/pipeline` page) | Sums `enhanced_estimates.selling_price` per entry — picks `metadata.selected_estimate_id` first, otherwise highest `selling_price` | If the selected estimate is a draft with `selling_price = 0` (e.g. Gary Neiskes case in DB), total drops to $0 for that lead. No fallback to the lead's `estimated_value` or to a sibling non-zero estimate. |
| `src/features/pipeline/components/KanbanPipeline.tsx` (floating panel + mobile usage) | Hard-coded `total={formatCurrency(0)}` on line 259 | Always shows $0 — never reflects estimates at all. |

DB confirms 9 leads in `legal_review`: only 4 have estimates linked, one of those has `selling_price = 0`, and several leads still hold an `estimated_value` but no estimate row.

## Goal

Both pipeline UIs show the same header total: **sum of the best saved estimate `selling_price` per lead, falling back to `estimated_value` only when no usable estimate exists.**

## Changes

### 1. Centralize estimate-price lookup in the hook
File: `src/hooks/usePipelineData.ts`

- After fetching `pipeline_entries`, batch-fetch `enhanced_estimates(id, pipeline_entry_id, selling_price, status)` for those entry ids.
- Build `estimatePriceMap: Map<entryId, number>` using this priority:
  1. The estimate matching `metadata.selected_estimate_id` / `metadata.enhanced_estimate_id` **if its `selling_price > 0`**.
  2. Otherwise the estimate with the highest `selling_price > 0` for that entry.
  3. Otherwise `pipeline_entries.estimated_value` (so legacy leads without an estimate still contribute).
  4. Otherwise 0.
- Add `estimated_value` and `metadata` to the `PipelineEntry` select / interface so step 3 works.
- Expose two new return values from the hook:
  - `entryValue(entryId): number`
  - `stageTotals: Record<stageKey, number>` computed from `groupedData` + `entryValue`.

### 2. Fix the floating / mobile Kanban
File: `src/features/pipeline/components/KanbanPipeline.tsx`

- Replace `total={formatCurrency(0)}` (line 259) with `total={formatCurrency(stageTotals[stage.key] || 0)}` from the hook.

### 3. Reuse the same logic in the main pipeline
File: `src/features/pipeline/components/Pipeline.tsx`

- Replace the in-component `estimatePriceMap` block (around lines 324–352) and the manual `stageTotals` reduce (lines 354–381) with the hook's `entryValue` / `stageTotals`, OR keep local code but apply the same priority rules as the hook so the two views can never diverge again.
- Keep the orphaned-entries handling, but feed those values through `entryValue` too.

### 4. No schema changes
All data already exists in `enhanced_estimates.selling_price`, `pipeline_entries.estimated_value`, and `pipeline_entries.metadata`.

## Verification

1. Open `/pipeline` on desktop and the floating Kanban panel — Legal Review header total should be identical in both views.
2. For Gary Neiskes (selected estimate has `selling_price = 0`) — total should now use `estimated_value` ($60,000) rather than $0.
3. For Irina Gorovits — total still uses the estimate's `selling_price` ($60,662.19).
4. Move a lead in/out of Legal Review — totals in both views update via React Query cache.
5. Confirm KanbanPipeline.tsx no longer shows `$0` on every column.

## Open question

Should the priority be **selected estimate first even when zero** (current Pipeline.tsx behavior, which is what produced the user's complaint), or **highest non-zero selling_price first, then `estimated_value`** (this plan)? This plan assumes the latter — confirm before implementing if you'd prefer a different rule (e.g. only `selling_price`, never `estimated_value`).