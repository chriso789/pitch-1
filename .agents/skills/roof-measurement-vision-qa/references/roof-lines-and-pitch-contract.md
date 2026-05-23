# Roof Lines & Pitch Contract

Covers Rules 3, 9, 10, 11.

## Rule 3 — True outer roof perimeter before topology

No internal topology may run until a true outer roof perimeter is selected.

**Forbidden as the final perimeter:**
- `solar_segment_union`
- `solar_segment_hull`
- `solar_bbox`
- parcel boundary
- global mask bbox
- interior solar plane contour
- loose / unmatched OSM footprint

**Allowed (only after validation):**
- target roof mask contour
- refined aerial-visible roof boundary
- DSM roof-to-ground boundary
- user-verified perimeter
- high-confidence OSM / Mapbox footprint **only if** `IoU >= 0.85` vs target roof mask

Persist `perimeter_source` and `forbidden_perimeter_source_attempted` (array of any forbidden candidates considered, for audit).

## Rule 9 — Typed `roof_lines` only

Final report totals come from typed `roof_lines` rows, not generic edges.

Required fields per line:

```
measurement_id
geometry_px
geometry_geo
length_lf
layer_id
non_dimensional_attribute   ← see allowed list below
source
confidence
adjacent_plane_ids
can_be_customer_reported
```

Allowed `non_dimensional_attribute`:

```
perimeter | eave | rake | ridge | hip | valley
wall_flashing | step_flashing | common | unknown
```

Any other value is a developer bug — reject at write time.

## Rule 10 — Pitch safety

Never output final pitch from collapsed or undersegmented topology.

Decision tree:

```
if topology_invalid OR topology_fidelity in (low, medium) OR pitch < 2/12:
    if solar.roofSegmentStats available:
        pitch_source = "solar_roof_segment_stats"
        pitch = solar weighted average ± 1/12
    else:
        pitch_source = "unavailable"
        pitch = null
else:
    pitch_source = "perimeter_ridge_geometry"
```

**Banned outputs** (collapsed-plane fits):
- `0.11/12`
- `1.67/12`
- any pitch < 2/12 that did not pass the Solar fallback

## Rule 11 — Customer report gate

`customer_report_ready = true` only when ALL of:

- confirmed roof target exists (`user_confirmed_roof_target` OR `roof_target_admin_override`)
- `canonical_measurement_route = true`
- true perimeter passes (or safe raw fallback validated)
- perimeter refinement safe or `refinement_fallback_used = "raw_perimeter"` with `conservative_raw_gate.passed = true`
- typed `roof_lines` exist with at least one line per required attribute set for the report
- `pitch_valid = true`
- topology not undersegmented (`topology_undersegmented_after_backbone_repair` absent)
- ridge / hip / valley evidence structurally valid (or vendor-verified override)
- no `developer_bug`
- no schema or runtime failure

If any fail:

```
customer_report_ready = false
diagram_render_intent ∈ { "rejected_only", "perimeter_debug_only" }
hard_fail_reason      = <stage-specific>
```
