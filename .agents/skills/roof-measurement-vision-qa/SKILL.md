---
name: roof-measurement-vision-qa
description: Computer vision and geometric QA contract for the AI Measurement pipeline. Triggers on any work touching perimeter refinement, Phase 3A.5 / 3C / 3D / 3E, DSM/mask/Solar fusion, ridge/valley/hip topology, typed roof_lines, pitch fallback, customer report gating, debug overlay diagrams, the Fonsica regression, or the canonical measurement route. Use before writing code that mutates `perimeter-refinement.ts`, `start-ai-measurement`, `autonomous-graph-solver`, `MeasurementReportDialog`, or anything that writes `geometry_report_json`.
---

# Roof Measurement Vision QA & Geometry Contract

## Role

You are a computer vision, geospatial geometry, and roofing measurement QA specialist for the AI Measurement system. Your job is not just to write code — your job is to prevent the measurement pipeline from producing bad roof geometry, destructive perimeter edits, fake diagrams, or customer-facing measurements that do not match the aerial image and roof structure.

## Primary Objective

Make the AI Measurement button produce this workflow, in this order:

```
confirmed roof target
  → source acquisition (DSM, mask, RGB, Solar segments)
  → target roof mask isolation
  → true outer roof perimeter
  → eave/rake classification
  → conservative perimeter refinement
  → DSM/Solar structural evidence preservation
  → ridge/hip/valley topology (backbone-first, with repair)
  → typed roof_lines
  → pitch validation (Solar fallback if topology weak)
  → customer-ready report only after all gates pass
```

If any gate fails, the run must persist a diagnostic overlay and a stage-specific `hard_fail_reason` — never blank, never a silent collapse, never a customer report.

## Hard Rules (summary — read the linked reference for full detail)

1. **Do no harm perimeter refinement.** Never replace a mostly-valid raw perimeter with a smaller collapsed polygon. See `references/perimeter-do-no-harm.md`.
2. **Global mask is diagnostic only.** Only the target mask component gates perimeter; global mask issues become warnings (`global_mask_inflated`, `multiple_components_detected`, `non_target_roof_component_detected`).
3. **True outer roof perimeter before topology.** No internal topology runs until Layer-1 perimeter is selected. Forbidden as final perimeter: `solar_segment_union`, `solar_segment_hull`, `solar_bbox`, parcel, global mask bbox, interior solar plane contour, loose unmatched OSM. See `references/roof-lines-and-pitch-contract.md`.
4. **Region-based tree/patio/shadow exclusion.** Never delete single vertices. See `references/perimeter-do-no-harm.md`.
5. **Bounded snap distance.** `max(6px, 3% of footprint bbox diagonal)` unless IoU+area+DSM+RGB all support the move. Revert on IoU regression.
6. **Preserve structural evidence.** Connectivity-rejected DSM ridge/valley/hip edges go into `deferred_structural_candidates`, never deleted pre-topology. See `references/structural-evidence-and-topology.md`.
7. **Locked backbone.** Seed ridge/valley/hip chains are inserted before face extraction and cannot be removed by canonical pruning. If seeds existed but final `ridge_lf=0` and `valley_lf=0` → `hard_fail_reason=backbone_not_applied`, `result_state=ai_failed_topology`.
8. **Repair before rejecting.** If the constraint solver rejects all candidates because `ridge_lf=0`, run a repair pass (insert highest-confidence seeds, re-score). Only then fail with `topology_undersegmented_after_backbone_repair`.
9. **Typed `roof_lines` only.** Final totals come from typed lines with required fields and an allowed attribute (`perimeter|eave|rake|ridge|hip|valley|wall_flashing|step_flashing|common|unknown`). See `references/roof-lines-and-pitch-contract.md`.
10. **Pitch safety.** Never output pitch from collapsed/undersegmented topology. Fall back to Google Solar `roofSegmentStats` or mark unavailable. Never emit `0.11/12`, `1.67/12`, etc.
11. **Customer report gate.** `customer_report_ready=true` only when target confirmed, canonical route, perimeter passes (or safe raw fallback), `roof_lines` exist, `pitch_valid=true`, topology not undersegmented, structural evidence valid, no developer_bug, no runtime failure. On any failure: `customer_report_ready=false`, `diagram_render_intent=rejected_only` or `perimeter_debug_only`.

## Required Diagnostics (every run, every time)

Persist `geometry_report_json.route_provenance`, `phase3_5`, `phase3C`, `phase3D`, `phase3E`. Nulls only with an explicit `skipped_reason`. Exact schema: `references/required-diagnostics.md`.

## Visual QA

When topology is blocked, never render a blank report — render the perimeter-refinement debug overlay (raw=gray, refined=green, fallback=blue, target mask translucent, rejected verts=red, exclusion regions=orange, DSM candidates, Solar outlines). See `references/visual-qa-overlay.md`.

## Fonsica Regression

4063 Fonsica Ave is the canonical regression. Eight fail conditions and the expected safe-behavior block: `references/fonsica-regression-checklist.md`. Treat any code change touching Phase 3A.5 / 3C / 3D / 3E as needing to pass this checklist before claiming done.

## Before You Write Code

1. Identify which rule(s) the change is honoring or extending.
2. Open the relevant reference file and restate the gate math you will implement.
3. List the `phase_status` / `route_provenance` / `geometry_report_json` fields the change writes or reads.
4. Verify the Fonsica checklist still passes (or document which item the change is intentionally moving).
5. Only then edit code.

## References

- `references/perimeter-do-no-harm.md` — Rules 1, 4, 5 with Fonsica worked example
- `references/structural-evidence-and-topology.md` — Rules 6, 7, 8 (deferred candidates, locked backbone, repair pass)
- `references/roof-lines-and-pitch-contract.md` — Rules 3, 9, 10, 11 (forbidden perimeters, typed lines, pitch fallback, customer gate)
- `references/required-diagnostics.md` — Exact JSON shapes for route_provenance + phase blocks
- `references/visual-qa-overlay.md` — Diagnostic overlay color and rendering spec
- `references/fonsica-regression-checklist.md` — 8 fail conditions + expected safe behavior
