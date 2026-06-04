# PITCH vs Nearmap — Capability Gap Map

**Mission:** Beat Nearmap WITHOUT integrating Nearmap. Use Nearmap's published capability
matrix only as a benchmark. Every row below maps a Nearmap-style capability to the
first-party PITCH source(s) that must cover it — built on free / public / already-connected
data plus the internal Python worker (`worker/app/skills/*`).

> **Rule:** Nearmap is NEVER added as a provider. Any new "provider" row for Nearmap in
> `mskill_provider_sources` is a violation of this contract.

---

## 1. Capability ↔ PITCH source matrix

| # | Nearmap capability | PITCH equivalent | Sources | Worker skill / executor | Status |
|---|---|---|---|---|---|
| 1 | Coverage / survey freshness metadata | Provider inventory + LiDAR coverage + source freshness | `mskill_provider_sources`, `mskill_provider_coverage`, `mskill_lidar_windows.data_year` | `discover_lidar_coverage`, `discover_elevation_assets`, `verifyRoofSurfaceDataAvailability` | ✅ frame in place, **freshness fields wired in Phase 1** |
| 2 | Vertical (ortho) imagery | Google Static Maps / Mapbox satellite tile | Google Maps Static API (already connected), Mapbox (already connected) | (UI layer, no worker skill required) | ✅ existing |
| 3 | Oblique / panorama imagery | Future oblique slot — user uploads, drone, future open dataset | placeholder columns on `mskill_jobs.oblique_image_sources` | (no skill yet — slot only) | 🟡 placeholder |
| 4 | DSM (highest returns surface) | First-return rasterization from public LiDAR | USGS 3DEP, NOAA Digital Coast, LABINS (FL), county LiDAR | `worker:/skills/generate-dsm` | 🟢 **Phase 2** (this build) |
| 5 | DTM (bare earth) | Ground-class returns rasterization | same as DSM | `worker:/skills/generate-dtm` | 🟢 **Phase 2** |
| 6 | nDSM / CHM (height above ground) | DSM − DTM | derived | `worker:/skills/generate-chm` | 🟢 **Phase 2** |
| 7 | AI building footprint | County footprint + Microsoft Building Footprints + FEMA USA Structures, validated against parcel | County GIS, Microsoft ML Footprints (open), FEMA USA Structures (open), Regrid parcels | `resolve_building_footprint`, `resolve_parcel` | ✅ existing |
| 8 | Roof characteristics / material / pitch prior | Roof-type inference + legacy AI material classifier + future visual classifier | `roof-type-inference.ts`, existing estimates metadata, future visual model | `roof-type-inference` shared module | ✅ existing |
| 9 | Roof objects (HVAC, skylights, chimneys, vents) | Obstruction mask from DSM bumps + imagery diffs | DSM, CHM, satellite imagery | `worker:/skills/isolate-roof-points` (emits `obstruction_mask_url`) | 🟢 **Phase 3** |
| 10 | Roof condition (soiling, ponding, damage) | Visual condition classifier — **not in measurement core** | future model | (not in current scope) | 🔴 deferred |
| 11 | Roof measurements (planes, ridges, hips, valleys, eaves, rakes, pitch, area) | First-party geometry engine | LiDAR / DSM / CHM + refined perimeter | `fit_roof_planes`, `detect_ridges/hips/valleys/eaves/rakes`, `calculate_pitch`, `calculate_roof_area` | 🟢 **Phase 4–6** |
| 12 | QA / confidence per measurement | First-party `geometry_quality_score` | derived from source + plane RMSE + coverage | `validate_geometry` + `geometry_quality_score` | 🟢 **Phase 7** |

---

## 2. Source ladder (what PITCH actually pulls from)

Ordered best → worst for each output:

### Point cloud
1. NOAA Digital Coast LAZ tiles (coastal coverage incl. FL panhandle)
2. USGS 3DEP downloadable LAZ / EPT
3. County-published LAZ (varies — Pinellas, Hillsborough, Pasco have it)
4. LABINS (FL Land Boundary Info System) LiDAR
5. **No fallback.** No point cloud ⇒ `roof_geometry_possible = false`.

### DSM raster
1. Worker-generated DSM from #1–#4 above
2. Published DSM products (USGS 3DEP DSM tiles where available)
3. **No fallback.** DEM-only ⇒ `roof_geometry_possible = false`.

### DTM raster
1. Worker-generated DTM from ground returns
2. USGS 3DEP DEM (1m / 1/3 arc-second)
3. NOAA Coastal DEM

### Building footprint
1. County GIS footprint (when available)
2. Microsoft ML Building Footprints (US-wide open dataset)
3. FEMA USA Structures
4. Manual draw

### Parcel
1. Regrid (already connected)
2. County parcel GIS

### Imagery (visual QA only — never used for measurements)
1. Google Static Maps satellite
2. Mapbox satellite
3. ESRI World Imagery (open)

---

## 3. Hard rules

1. **DEM/DTM alone CANNOT produce roof geometry.** Worker returns
   `status="failed"`, `reason="dsm_or_point_cloud_required"`.
2. **LiDAR coverage record ≠ usable data.** A coverage polygon without a downloadable
   `source_url` is `roof_geometry_possible = false`.
3. **Building footprint ≠ roof edge.** Roof perimeter MUST come from
   `refine_roof_perimeter_from_surface` (Phase 3) before any report.
4. **No stub artifact unblocks downstream skills.** `needs_implementation` is fail-closed.
5. **Single final writer** to `roof_measurements` remains the bridge — enforced by
   `writer-guard.ts`.
6. **No Nearmap.** Adding `provider_key='nearmap'` requires explicit user override and
   is treated as out-of-policy.

---

## 4. Build order (mirrors the next-step plan)

```
Phase 1  verifyRoofSurfaceDataAvailability  +  source diagnostics
Phase 2  generate_dsm  →  generate_dtm  →  generate_chm
Phase 3  isolate_roof_points  →  refine_roof_perimeter_from_surface
Phase 4  fit_roof_planes
Phase 5  detect_ridges / hips / valleys / eaves / rakes
Phase 6  calculate_pitch  +  calculate_roof_area
Phase 7  validate_geometry  +  geometry_quality_score
Phase 8  bridge writer  →  roof_measurements  →  AI Measurement button rewire
```

A roof report is **only** customer-ready when every phase passes its hard gate AND
`geometry_quality_score.pass = true`.
