# OpenTopography DSM Fallback

## Goal
Stop `dsm_bounds_missing` hard-fails (like the Fonsica run) by using USGS 3DEP 1m DSM from OpenTopography whenever Google Solar returns a raster without a usable georeference.

## What ships

### 1. New shared module: `supabase/functions/_shared/opentopo-dsm-source.ts`
- `fetchUsgs3DepDsm({ lat, lng, radiusMeters })` — calls OpenTopography `globaldem` API with `demtype=USGS1m` (US, best resolution), falls back to `USGS10m`, then `SRTMGL1` outside US.
- Requests GeoTIFF with explicit bbox → response ALWAYS has valid bounds (we send them, they echo back in the raster).
- Returns `{ tiff: ArrayBuffer, bounds: {sw,ne}, mpp: number, source: 'usgs_3dep_1m' | 'usgs_3dep_10m' | 'srtm_gl1', tileSize: {w,h} }`.
- Uses `Deno.env.get('OPENTOPOGRAPHY_API_KEY')`.
- All failures return `{ error, http_status, latency_ms }` for the evidence log — never throws.

### 2. Wire into DSM registration cascade
In `supabase/functions/_shared/early-dsm-registration.ts` (and the acquisition step it calls):
- After Google Solar DSM is fetched, if `dsm_bounds_source === 'missing'` AND raster-bounds derivation also fails, call `fetchUsgs3DepDsm` with the confirmed lat/lng and a radius derived from the Solar tile size (fallback: 80m).
- Feed the returned bounds + tiff into the same registration path — `dsm_bounds_source` becomes `usgs_3dep_1m` (new enum value in `DsmBoundsSource`).
- Persist `dsm_registration_source` on the row so we can audit which runs used the fallback.

### 3. Evidence log entry
Push one attempt into `evidence_acquisition_log`:
```
{ layer: 'dsm', source: 'opentopography_usgs1m', status: 'ok'|'empty'|'error', latency_ms, http_status }
```
So the EvidenceSourcesPanel shows exactly what happened.

### 4. Gating — customer-report readiness
Per your earlier question: when `dsm_registration_source === 'usgs_3dep_1m'`, allow the same `customer_report_ready` states as Google Solar-registered runs (3DEP 1m is equal or better resolution than Solar's ~0.13 m/px effective sampling for a house-sized AOI, and it carries authoritative georef). No perimeter-only gate. If it drops to `usgs_3dep_10m` or `srtm_gl1`, hard-cap at `perimeter_only` — 10m/30m is too coarse for facet-level topology.

### 5. Tests
- Unit test in `tests/edge-functions/opentopo-dsm-source.test.ts`: mock fetch, assert bbox math, assert graceful failure path, assert `usgs_3dep_1m → usgs_3dep_10m → srtm_gl1` cascade.
- Add a route audit assertion that `dsm_bounds_source` may equal `usgs_3dep_1m` and still be canonical.

## Non-goals (this pass)
- No LidarExplorer direct integration — OpenTopography already fronts USGS 3DEP and is one auth surface.
- No reprocessing of past failed runs; user can rerun Fonsica manually to confirm.

## Files touched
- **new** `supabase/functions/_shared/opentopo-dsm-source.ts`
- **edit** `supabase/functions/_shared/dsm-registration.ts` (add `usgs_3dep_1m|usgs_3dep_10m|srtm_gl1` to `DsmBoundsSource`, accept these as valid non-derived bounds)
- **edit** `supabase/functions/_shared/early-dsm-registration.ts` (invoke fallback when Solar bounds missing)
- **edit** `supabase/functions/start-ai-measurement/index.ts` (evidence log push + gating for 10m/30m tiers)
- **edit** `supabase/functions/_shared/result-state.ts` (map `srtm_only`/`usgs_10m_only` to `perimeter_only`)
- **new** `tests/edge-functions/opentopo-dsm-source.test.ts`

Ship it?
