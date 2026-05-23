# Visual QA Overlay

When topology is blocked the report must **never render blank**. Render a diagnostic overlay derived from `phase3_5.debug_perimeter_overlay_svg` and the phase 3C/D/E debug layers.

## Layer color spec

| Layer | Color | Notes |
|---|---|---|
| Raw perimeter | gray (`#9ca3af`) | always shown |
| Refined perimeter (if any) | green (`#10b981`) | only if Phase 3A.5 produced one |
| Selected fallback perimeter | blue (`#3b82f6`) | when `refinement_fallback_used` is set |
| Rejected perimeter | red stroke + low-opacity fill | when `refinement_rejected = true` |
| Target mask | translucent fill (`#22c55e` @ 0.15 opacity) | always |
| Global mask outline | dashed gray | only if `multiple_components_detected` |
| Rejected vertices | red dots | from `vertices_removed_pct` source set |
| Exclusion regions | orange (`#f97316`) | applied = solid, rejected = dashed |
| DSM edge candidates | thin cyan | accepted = solid, deferred = dashed |
| Solar segment outlines | thin purple | when available |

## Render-intent rules

- `diagram_render_intent = "customer_report"` — only when `customer_report_ready = true`.
- `diagram_render_intent = "rejected_only"` — render the perimeter-refinement debug overlay (not blank).
- `diagram_render_intent = "perimeter_debug_only"` — Phase 3A.5 overlay + rejection chip listing `refinement_rejection_reason` and `selected_perimeter_after_refinement`.

## UI chips

Always show, when available:
- `Route: canonical ✓ | non-canonical ✗`
- `Phase 3A.5: passed | rejected (<reason>) | fallback=raw`
- `Phase 3D: backbone_applied | backbone_not_applied`
- `Phase 3E: repair_accepted | repair_failed (<reason>)`
- `Pitch source: perimeter_ridge | solar_roof_segment_stats | unavailable`

## "Never blank" invariant

If any of the following are present, the dialog MUST render the overlay:
- `phase3_5.debug_perimeter_overlay_svg`
- `phase3_5.raw_perimeter_*`
- `phase3C.deferred_structural_candidates_count > 0`

Empty `geometry_report_json` is itself a developer bug — show the route_provenance chip and a `phase_block_missing` rejection card.
