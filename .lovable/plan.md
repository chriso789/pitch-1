## Problem

Database evidence from 4063 Fonsica shows all failed runs have:
- `footprint_source: null`
- `grj_footprint_valid: null`  
- `grj_coordinate_match: null`
- `internal_debug_report_ready: false`
- `gate_reason: dsm_edges_found_no_closed_faces` or `ai_failed_complex_topology`

The footprint diagnostics are never persisted, and the UI shows "footprint: unknown" + "No diagrams available". The solver runs even when the footprint doesn't overlap the DSM grid.

## Changes

### 1. DSM Coordinate Match Gate (`start-ai-measurement/index.ts`, ~lines 1020-1038)

After DSM/mask loads and before `solveAutonomousGraph`:
- Convert footprint geo coords to DSM pixel space via `geoToPixel()`
- Compute footprint bbox in DSM pixels and check overlap with DSM grid dimensions
- Require >50% overlap with 5px tolerance

Two hard blocks before the solver call:
- `footprintSource === "none" || "unknown"` -> fail as `missing_valid_footprint`, do NOT call solver
- `dsmCoordinateMatch === false` -> fail as `footprint_coordinate_mismatch`, do NOT call solver

Both blocks persist a failed `roof_measurements` row with full debug payload including `footprint_px`, DSM bbox, coordinate match details, and set `internal_debug_report_ready = true`.

### 2. Persist Footprint Diagnostics on All Rows (`start-ai-measurement/index.ts`)

Update `insertFailedPreliminaryMeasurement` (~line 4946):
- Always include `footprint_px` in `overlay_debug` from the debug payload
- Always include `raster_url` from imageUrl parameter
- Always include `raster_size` (needs to be passed or derived)
- Set `internal_debug_report_ready = true` (already done on some paths but not all)

Update `autonomousDebug` object (~line 1040):
- Add `dsm_coordinate_match: dsmCoordinateMatchDebug`
- Ensure `footprint_px` is always included in `overlay_debug` section

Update the success path `geometryReportJson` (~line 3911):
- Add `footprint_valid`, `footprint_point_count`, `footprint_area_sqft`, `footprint_bbox`, `dsm_coordinate_match` at the top level

### 3. Fix Debug UI — MeasurementReportDialog (`MeasurementReportDialog.tsx`, ~lines 600-860)

Fix "footprint: unknown" display:
- Read footprint source from multiple fallback paths: `footprint_source`, `geometry_report_json.footprint_source`, `geometry_report_json.debug_geometry.footprint_source`, `geometry_report_json.dsm_planar_graph_debug.footprint_source`
- Add coordinate_match badge to the header metadata

Fix "No diagrams available" for diagnostic reports:
- Change the overlay display predicate from `planes_px.length > 0 || edges_px.length > 0` to also include `footprint_px exists`
- When `internal_debug_report_ready = true` but `customer_report_ready = false`, always show diagnostic controls even with 0 planes/edges
- Render footprint polygon from `overlay_debug.footprint_px` even when there are no faces

### 4. Fix DSMDebugOverlay (`DSMDebugOverlay.tsx`)

Add new fields to `OverlayDebugData` interface:
- `footprint_source?: string`
- `footprint_valid?: boolean`  
- `footprint_point_count?: number`
- `footprint_area_sqft?: number`
- `dsm_coordinate_match?: { match: boolean; overlap_ratio: number; footprint_dsm_bbox: any; dsm_bbox: any }`

Display these in the stats bar, including a coordinate_match badge (green/red).

### 5. Backfill Failed Rows (SQL migration)

A small migration to update existing failed `roof_measurements` rows:
```sql
UPDATE roof_measurements 
SET internal_debug_report_ready = true 
WHERE validation_status = 'failed' 
  AND internal_debug_report_ready = false 
  AND gate_reason IS NOT NULL;
```

### 6. Deploy and Validate

Deploy `start-ai-measurement` edge function. Check latest 4063 Fonsica logs for the new diagnostics.

## Hard Rules Enforced

1. If `footprint_source` is `unknown` or `none` OR `coordinate_match` is `false`: do NOT call `solveAutonomousGraph`
2. Even when `planes = 0` and `edges = 0`: render `footprint_px` + DSM bbox + failure reason in the debug overlay
3. `internal_debug_report_ready = true` on every failed row regardless of failure type