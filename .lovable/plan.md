## Goal

Make the AI Measurement button produce a **visually correct outer roof perimeter / eave-rake diagram first** before any internal hips/ridges/valleys are claimed as customer-ready. Build the six remaining pieces on top of the perimeter persistence layer that already shipped.

Scope is intentionally limited: do **not** rewrite or improve internal topology. Only extend perimeter behavior, validation, debug visibility, and the report-state gating around it.

---

## 1. Four-outline `DSMDebugOverlay`

Extend `src/components/measurements/DSMDebugOverlay.tsx` to render all four candidate outlines simultaneously when the data is available, each with a distinct color, label, and toggle:

```
true_outer_roof_perimeter_px   → green   (selected perimeter)
roof_mask_contour_px           → cyan    (raw mask contour)
solar_segment_union_px         → orange  (rejected: solar union)
aerial_visible_boundary_px     → magenta (vision/contrast estimate)
```

Plus overlay layers:

- `missed_roof_regions` filled red @ 35% opacity with a `Missed roof area X%` badge
- Rejected perimeter candidates drawn as dashed gray
- `selected perimeter source` chip (e.g. `mask_contour_snapped`)
- `perimeter_confidence` value
- Eave edges labeled `EAVE`, rake edges labeled `RAKE` along midpoints
- Legend panel with toggle switches per layer

A small "Perimeter Diagnostics" panel above/beside the canvas shows: `perimeter_area_sqft`, `perimeter_total_lf`, `eave_lf`, `rake_lf`, `perimeter_vs_mask_iou`, `missed_roof_area_pct`, `centroid_offset_px`, `perimeter_confidence`, `perimeter_gate_passed`, `result_state`.

---

## 2. Perimeter-only report state

Touchpoints:
- `supabase/functions/start-ai-measurement/index.ts` — already derives `result_state`. Add explicit branch: `perimeter_passed && !topology_passed → result_state='perimeter_only'`, `customer_report_ready=false`.
- `src/components/measurements/UnifiedMeasurementPanel.tsx` and the report viewer:
  - When `result_state='perimeter_only'`:
    - Banner: "Perimeter validated, internal topology failed."
    - Show only: total area, eaves LF, rakes LF, pitch source
    - Hide or watermark hips / ridges / valleys with a "DIAGNOSTIC — NOT CUSTOMER READY" stripe
    - Disable the "Generate customer PDF" action (button shows tooltip: requires customer_report_ready)
- Saved Measurements UI: badge `Perimeter only` (amber) instead of `Ready` (green).

---

## 3. Mask-contour aerial snap algorithm

New module: `supabase/functions/_shared/mask-contour-aerial-snap.ts`.

Inputs: `roof_mask_px`, `aerial_rgb_tile`, `dsm_tile`, `mask_contour_px`.

Steps:
1. Trace outer contour of the roof mask (single largest connected component, plus any fragment within 8–12 px that aligns with continued roof boundary — merge those).
2. For each contour vertex, search ±N px along the inward normal for:
   - Strongest Sobel/Canny edge in the aerial RGB tile
   - DSM height-break ≥ 0.6 m (roof-to-ground transition)
3. Snap vertex to the strongest combined evidence; preserve corners (Douglas-Peucker corner protection, angle threshold 25°).
4. Reject the result and fall back to raw mask contour if snapped polygon area deviates from mask area by >12% or self-intersects.
5. Forbidden perimeter sources remain hard-rejected (already enforced in `perimeter-topology.ts`): `solar_segment_union`, `solar_segment_hull`, `solar_bbox`, `parcel_boundary`, loose OSM unless matched to mask (IoU ≥ 0.85 with mask contour).

Output: `{ perimeter_px, perimeter_geo, eave_edges, rake_edges, corners, perimeter_source, perimeter_confidence, perimeter_vs_mask_iou, snap_diagnostics }`.

Wire into `start-ai-measurement` perimeter resolution before topology.

---

## 4. Constrained-perimeter topology solver

Add a thin wrapper: `supabase/functions/_shared/constrained-perimeter-solver.ts`.

Once `perimeter_gate_passed=true`, this wrapper invokes the existing internal solver (`autonomous-graph-solver.ts` / `constraint-roof-solver.ts`) with hard constraints:

- Perimeter polygon is read-only (cannot be modified by internal solver)
- All internal edge endpoints must snap to a perimeter node OR a perimeter edge (within 4 px tolerance)
- No internal face vertex may lie outside the perimeter (point-in-polygon check)
- Perimeter eave/rake edge classifications are fixed boundary conditions (internal solver may not relabel them)

If any constraint is violated post-solve → discard internal topology, mark `topology_status='constraint_violation'`, propagate to `result_state='perimeter_only'`.

---

## 5. Acceptance metrics persistence

Migration to add columns to `roof_measurements`:

- `perimeter_area_sqft` numeric
- `perimeter_total_lf` numeric
- `eave_lf` numeric
- `rake_lf` numeric
- `perimeter_vs_mask_iou` numeric
- `missed_roof_area_pct` numeric
- `centroid_offset_px` numeric
- `perimeter_gate_passed` boolean

(`perimeter_confidence` and `result_state` already exist from previous migration.)

Compute and persist in `start-ai-measurement` immediately after the perimeter solver runs, regardless of pass/fail.

---

## 6. Fonsica validation gates

In the perimeter gate logic (`perimeter-topology.ts` `evaluatePerimeterGate`):

- area within ±5% of mask-derived area
- (eave_lf + rake_lf) within ±8% of perimeter total LF expectation
- missed_roof_area_pct < 5%
- perimeter_confidence ≥ 0.85

If **all four** pass → `perimeter_gate_passed=true`. Otherwise → `result_state='ai_failed_perimeter'`.

Add a benchmark row for Fonsica (area 3,077 sqft, eaves+rakes 264 LF, pitch 6/12) into `roof_measurement_benchmarks` so post-run comparison surfaces in vendor benchmark gate.

---

## Out of scope for this checkpoint

- No improvements to internal hip/ridge/valley detection
- No changes to PDF customer report layout beyond the watermark/disable when `perimeter_only`
- No retraining of any models (UNet remains not built)

---

## Files touched

- **Migration**: add 8 columns to `roof_measurements`; insert Fonsica benchmark row.
- `supabase/functions/_shared/mask-contour-aerial-snap.ts` (new)
- `supabase/functions/_shared/constrained-perimeter-solver.ts` (new)
- `supabase/functions/_shared/perimeter-topology.ts` (extend gate to 4 conditions, persist metrics)
- `supabase/functions/start-ai-measurement/index.ts` (wire snap + constrained solver, persist metrics, derive `perimeter_only`)
- `src/components/measurements/DSMDebugOverlay.tsx` (4-outline rendering, missed regions, legend, diagnostics panel)
- `src/components/measurements/UnifiedMeasurementPanel.tsx` (perimeter_only banner, watermark, disable PDF)
- `src/features/measurements/SavedMeasurements*.tsx` (perimeter-only badge)
- Memory file: `mem://architecture/measurement-system/perimeter-first-checkpoint-v1` documenting the four passing conditions.

---

## Order of implementation

1. Migration (columns + benchmark row) — must approve first before code.
2. Mask-contour aerial snap module + perimeter gate v2 + metrics persistence.
3. Constrained-perimeter solver wrapper + result_state derivation.
4. DSMDebugOverlay 4-outline rendering + diagnostics panel.
5. UI: perimeter_only banner, PDF disable, saved-measurements badge.
6. Memory + Fonsica benchmark verification run.
