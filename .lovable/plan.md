

# Add "Estimate Sent" Stage + Fix Missing Roof Templates

## Two Issues Found

### Issue 1: "Estimate Sent" pipeline stage exists in the database but is missing from hardcoded transition maps

The `pipeline_stages` table has `estimate_sent` (stage_order 2, between Leads and Contingency Signed) for your tenant. However, several files have **hardcoded** status transition lists that don't include it:

**Files to update:**

1. **`supabase/functions/pipeline-status/index.ts`** (lines 63-77)
   - Add `estimate_sent` to `validTransitions` map:
     - `lead` can transition to `estimate_sent`
     - `estimate_sent` can transition to `contingency_signed` or back to `lead`
   - Add `estimate_sent` to the `allStatuses` array

2. **`src/pages/LeadDetails.tsx`** (lines 418-429)
   - Add `estimate_sent` to `strictTransitions`:
     - `lead` -> `['estimate_sent', 'contingency_signed']`
     - `estimate_sent` -> `['contingency_signed', 'lead']`

3. **`src/components/LeadCreationDialog.tsx`** (lines 99-104)
   - Add `{ value: "estimate_sent", label: "Estimate Sent" }` to `pipelineStatuses`

4. **`src/components/contact-profile/ContactJobsTab.tsx`** (line 333)
   - Add `estimate_sent` to `LEAD_STATUSES` array

5. **`src/features/dashboard/components/EnhancedDashboard.tsx`** (line 174)
   - Add `estimate_sent` to `allStatuses` array

6. **`src/features/contacts/components/EnhancedClientList.tsx`** (line 560)
   - Add `estimate_sent` to `leadStatuses` array

### Issue 2: "Premium" roof templates missing from template picker

The database has 17 active `estimate_calculation_templates`, but the template picker only shows templates where `template_category` is `'standard'` or `'roofing'`. Templates categorized as `'premium'` (GAF Timberline HDZ, Owens Corning Duration, SnapLok Painted, Worthouse panels) are filtered out.

**Root cause in `src/lib/trades.ts`** (line 18):
```
if (tradeValue === 'roofing') {
  return cat === 'roofing' || cat === 'standard';  // Missing 'premium'!
}
```

**Fix:** Update `matchesTradeCategory` to also match `'premium'` for the `'roofing'` trade:
```typescript
if (tradeValue === 'roofing') {
  return cat === 'roofing' || cat === 'standard' || cat === 'premium';
}
```

This will restore all 17 roofing templates (Shingle: 4, Metal: 5, Tile: 8) in the template picker dropdown, grouped by roof_type as before.

## Summary of All File Changes

| File | Change |
|------|--------|
| `src/lib/trades.ts` | Add `'premium'` to roofing category match |
| `supabase/functions/pipeline-status/index.ts` | Add `estimate_sent` transitions + deploy |
| `src/pages/LeadDetails.tsx` | Add `estimate_sent` to strict transitions |
| `src/components/LeadCreationDialog.tsx` | Add `estimate_sent` option |
| `src/components/contact-profile/ContactJobsTab.tsx` | Add to LEAD_STATUSES |
| `src/features/dashboard/components/EnhancedDashboard.tsx` | Add to allStatuses |
| `src/features/contacts/components/EnhancedClientList.tsx` | Add to leadStatuses |

