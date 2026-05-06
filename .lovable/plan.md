The cause is now clear from the live function logs: the engine is still selecting `google_solar_mask_contour` even when it is massively larger than the actual roof.

For the current example, the candidate log shows:

```text
google_solar_segments_union: 2,398 sqft, valid, score 0.996
google_solar_bbox:           2,454 sqft, valid, score 0.811
google_solar_segments_hull:  3,131 sqft, valid, score 0.987
google_solar_mask_contour:  17,592 sqft, valid, score 1.000  <-- selected incorrectly
```

That means the hard gates are not catching this case because the bad mask still has `coverage_ratio_vs_solar_bbox = 1.0`. It covers the Solar bbox, but also spills far outside it into the whole tile/neighbor area. The code is only checking whether the candidate covers enough of the Solar bbox, not whether the candidate has too much area outside the Solar bbox.

I will fix the footprint selection stage first, before any ridge/hip/area calculation runs.

Implementation plan:

1. Add an exterior spillover gate to footprint candidate scoring
   - Compute `outside_solar_bbox_area_px = candidate_area_px - candidate∩solar_bbox_area_px`.
   - Compute `outside_solar_bbox_ratio = outside_solar_bbox_area_px / candidate_area_px`.
   - Reject candidates when most of their area is outside the Solar building bbox.
   - This would reject the current 17,592 sqft `google_solar_mask_contour` because only about 2,454 sqft overlaps the Solar bbox and the rest is yard/neighbors/tile area.

2. Add a candidate-vs-Solar-bbox area ratio gate
   - Compare each candidate area directly to the Solar building bbox area.
   - Reject if `candidate_area / solar_bbox_area` is too high, e.g. over about `1.35` for mask contours and other non-authoritative footprints.
   - In this case: `17,592 / 2,454 = 7.17x`, so it would hard fail immediately.

3. Make Google Solar mask contour non-authoritative unless it passes containment checks
   - Keep mask contour as useful evidence.
   - Do not let it auto-win just because it has high coverage.
   - Only boost it if:
     - area is close to Solar segment/bbox area,
     - outside-spill ratio is low,
     - bbox size is plausible,
     - and it is near the selected roof target.

4. Prefer the roof-only candidate when the mask is inflated
   - For this example, the selected footprint should fall back to `google_solar_segments_union` or `google_solar_bbox`, not `google_solar_mask_contour`.
   - The green footprint should then stay around the actual roof instead of the entire lot/neighbor area.

5. Add a pre-solver hard fail for inflated footprints
   - If a footprint candidate is already known to be inflated, the engine must not call `solveAutonomousGraph`.
   - Failure code should be specific, e.g. `invalid_roof_footprint:mask_spills_outside_roof_target` or `invalid_roof_footprint:area_inflation_vs_solar_bbox`.

6. Store better diagnostics in failed/internal reports
   - Add these fields to the footprint debug payload:
     - `candidate_area_sqft`
     - `solar_bbox_area_sqft`
     - `candidate_to_solar_bbox_ratio`
     - `outside_solar_bbox_ratio`
     - `outside_solar_bbox_area_sqft`
     - `selected_candidate_source`
     - all rejected candidate reasons
   - This will make the diagnostic report explain exactly why a footprint was rejected.

7. Ensure blocked measurement jobs are consistently marked blocked at the job level
   - The result row is blocked, but recent `ai_measurement_jobs.report_blocked` still shows false in the database query.
   - I will align the job record update so the job itself also has `report_blocked = true`, `needs_review = true`, and a useful `source_context.gate_reason` when measurement output is not publishable.

8. Deploy and validate against the logged failing case
   - Re-run/validate the measurement function for `909 Windton Oak Dr`.
   - Expected outcome:
     - `google_solar_mask_contour` is rejected due to area spill/inflation.
     - selected footprint is roof-sized (`~2,400–3,100 sqft`) or the job fails with `invalid_roof_footprint`.
     - no customer-ready report is produced if the footprint is not roof-only.

Technical target files:

```text
supabase/functions/start-ai-measurement/index.ts
```

No UI change is required for the root fix. This is a backend measurement-gate correction.