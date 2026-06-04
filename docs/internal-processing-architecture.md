# PITCH Measure — Internal Processing Architecture

## Two planes

| Plane | Tech | Owns |
|---|---|---|
| **Control plane** | Lovable + Supabase (Postgres + Edge Functions, Deno) | tenancy, RLS, skill registry (`mskill_*`), dispatch, artifact pointers, bridge to `roof_measurements` |
| **Compute plane** | Python FastAPI worker (`worker/`) | PDAL / GDAL / Open3D / Rasterio / Shapely / Open3D — anything that cannot run in Deno |

The control plane is the source of truth. The worker is a **stateless
executor** that receives a payload, downloads inputs, produces artifacts,
writes them to Supabase Storage, and reports back. It owns no business
logic and no tenant data.

## Standardized environment variables

The control plane and the worker share **one** set of names for the
compute-worker boundary. Everywhere uses:

| Variable | Where | Purpose |
|---|---|---|
| `INTERNAL_WORKER_BASE_URL` | control plane | base URL of the compute worker (e.g. `http://host.docker.internal:8080`) |
| `INTERNAL_WORKER_API_KEY` | control plane **and** worker | shared secret — sent as `X-Internal-Worker-Api-Key` header in both directions |
| `WORKER_MODE` | worker | `development` or `production` |

The unrelated `INTERNAL_WORKER_SECRET` env var still exists in older
Supabase edge functions (`email-worker`, `messaging-worker`, etc.) — that
is a separate concept (edge-function → edge-function auth) and is kept
as a back-compat fallback on the `/worker/callback` route only.

## Repo layout

```
pitch-1/
├── src/                                # Lovable frontend (control plane UI)
├── supabase/                           # control plane (DB + edge functions)
│   ├── functions/measurement-api/
│   ├── functions/measurement-worker/   # dispatches to worker + callback sink
│   └── functions/_shared/mskill/
├── worker/                             # internal Python compute worker
│   ├── app/
│   │   ├── main.py                     # FastAPI app, registers all skills
│   │   ├── schemas.py                  # SkillRequest / SkillResponse
│   │   ├── skills_registry.py          # declarative skill list
│   │   ├── skills/clip_point_cloud.py  # FIRST real skill
│   │   ├── auth.py                     # INTERNAL_WORKER_API_KEY guard
│   │   └── config.py
│   ├── tests/
│   ├── Dockerfile                      # OSGeo GDAL base + PDAL + py deps
│   ├── requirements.txt
│   └── .env.example
├── shared/measurement-contracts/       # JSON Schemas shared by both planes
└── docker-compose.yml                  # local dev: worker on :8080
```

## Dispatch flow

```
mskill_runs row → measurement-worker (edge)
   │  payload built from mskill_jobs + parents
   ▼
POST  $INTERNAL_WORKER_BASE_URL/skills/<name>
      X-Internal-Worker-Api-Key: $INTERNAL_WORKER_API_KEY
      body: SkillRequest
   ▼
Worker:
  1. validate payload (Pydantic) + auth
  2. download source_url to TEMP_WORK_DIR (size-capped)
  3. compute (PDAL/Open3D/...)
  4. upload artifacts → Supabase Storage (mskill-artifacts/<tenant>/<job>/...)
  5. return SkillResponse with artifact pointers + qa_flags
   ▼
measurement-worker writes mskill_artifacts rows, advances skill_run.status
   • status="completed"  → only with real artifacts AND non-stub qa_flags
   • status="needs_implementation" or qa_flags includes "stub" →
       skill_run stays "requires_internal_worker", downstream BLOCKED
```

## Skills currently implemented

| Skill | Status |
|---|---|
| `clip_point_cloud` | **implemented** — PDAL crop of LAS/LAZ/COPC/EPT to AOI |
| everything else (`generate_dsm`, `generate_dtm`, `generate_chm`, `isolate_roof_points`, `fit_roof_planes`, ridges/hips/valleys/eaves/rakes, `calculate_pitch`, `calculate_roof_area`, `validate_geometry`, `export_report`) | scaffolded only — returns `needs_implementation` |

See `worker/app/skills_registry.py` for the canonical list. Every entry
maps 1:1 to a row in `mskill_registry` on the control plane.

### `POST /skills/clip-point-cloud`

**Purpose:** Download or stream a LiDAR source and clip it to the
measurement AOI, returning a clipped LAZ + diagnostics.

**Required input fields** (subset of `SkillRequest`):

- `skill_run_id`, `measurement_request_id`, `measurement_job_id`
- `request_hash` (≥ 16 chars)
- `source_url`
- `asset_type` — one of `las`, `laz`, `copc`, `ept`
- `aoi_geojson` — Polygon / Feature / FeatureCollection

**Optional:** `target_crs`, `parcel_geojson`, `building_footprint_geojson`,
`roof_edge_candidate_geojson`.

**Behavior:**

1. Validates auth (`X-Internal-Worker-Api-Key`) and request shape.
2. Parses AOI to WKT.
3. For LAS/LAZ: downloads to temp dir (capped by `MAX_DOWNLOAD_MB`).
   For COPC/EPT: streams via PDAL.
4. Runs PDAL pipeline: read → crop to AOI polygon → reproject (if
   `target_crs` set) → write LAZ.
5. Inspects output with `laspy` (point count, bounds, CRS).
6. Rejects when:
   - source exceeds `MAX_DOWNLOAD_MB`
   - PDAL produces no points
   - clipped bounds do not intersect AOI bounds
7. Uploads clipped LAZ to Supabase Storage at
   `measurement-requests/{measurement_request_id}/{request_hash}/point-clouds/{skill_run_id}/clipped.laz`.

**Status outcomes:**

| Status | When |
|---|---|
| `completed` | Real LAZ uploaded, `point_count > MIN_CLIPPED_POINT_COUNT`, bounds intersect AOI |
| `needs_review` | LAZ uploaded but `point_count < MIN_CLIPPED_POINT_COUNT` (sparse) — downstream stays blocked |
| `failed` | Any validation gate failed, PDAL error, upload error, or bounds outside AOI |

**Output payload:**

```json
{
  "point_count": 184231,
  "point_density_per_xy_unit": 12.4,
  "bounds": {"minx": ..., "miny": ..., "maxx": ..., "maxy": ...},
  "crs": "EPSG:6432",
  "file_format": "laz",
  "clipped_point_cloud_url": "measurement-requests/.../clipped.laz",
  "byte_size": 4827361
}
```

## Hard guardrails

1. **No fake completion.** Control plane refuses to promote a skill_run
   to `completed` when the response has `status="needs_implementation"`,
   `qa_flags` contains `"stub"` / `"no_real_compute"`, or no artifact
   was actually written. `clip_point_cloud` enforces this by only ever
   returning `completed` when an LAZ is on Storage.
2. **DEM/DTM ≠ DSM.** DEM/DTM alone cannot produce roof planes. The
   `fit_roof_planes` skill requires DSM **or** point cloud inputs.
3. **Footprint ≠ eaves.** Building footprint is wall-line only.
   `detect_eaves` consumes the approved roof edge candidate.
4. **Edge candidates aren't final** until `validate_geometry` passes.
5. **No paid providers by default.** Tenants opt in per provider; the
   worker never calls a paid API unless the dispatch payload says so.
6. **Artifact stamping.** Every artifact row carries
   `measurement_request_id`, `request_hash`, `measurement_job_id`,
   `skill_run_id`. The control plane refuses stale `request_hash`.
7. **Tenancy stays on the control plane.** The worker never resolves
   `tenant_id` from the payload — it only reads/writes Storage paths it
   was told to use.

## Local dev

```bash
cp worker/.env.example worker/.env
# edit worker/.env — set INTERNAL_WORKER_API_KEY + Supabase service-role creds
docker compose up --build measure-worker
curl http://localhost:8080/health
curl http://localhost:8080/capabilities | jq
```

Smoke-test `clip_point_cloud` (replace IDs / URL with real values):

```bash
curl -sS -X POST http://localhost:8080/skills/clip-point-cloud \
  -H "Content-Type: application/json" \
  -H "X-Internal-Worker-Api-Key: $INTERNAL_WORKER_API_KEY" \
  -d '{
    "skill_run_id": "00000000-0000-0000-0000-000000000001",
    "measurement_request_id": "00000000-0000-0000-0000-000000000002",
    "request_hash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "measurement_job_id": "00000000-0000-0000-0000-000000000003",
    "source_url": "https://example.com/tile.laz",
    "asset_type": "laz",
    "target_crs": "EPSG:6432",
    "aoi_geojson": {"type":"Polygon","coordinates":[[[...]]]}
  }' | jq
```

Point the control plane at the worker with:

```
INTERNAL_WORKER_BASE_URL=http://host.docker.internal:8080
INTERNAL_WORKER_API_KEY=<same value as worker .env>
```

## Failure modes (clip_point_cloud)

| Symptom | `qa_flags` | Likely cause |
|---|---|---|
| `missing_request_hash` | yes | control plane forgot to stamp `request_hash` |
| `missing_source_url` | yes | upstream skill (`acquire_roof_surface_asset`) hasn't produced a source yet |
| `unsupported_asset_type` | yes | non-LiDAR asset routed here by mistake |
| `invalid_aoi_geojson` | yes | bad polygon from `create_roof_edge_candidates` |
| `low_point_count` (status `needs_review`) | yes | LiDAR coverage too sparse for downstream geometry |
| `bounds_outside_aoi` (status `failed`) | yes | CRS mismatch — AOI is in lon/lat but source is projected |
| `storage_upload_failed` | yes | service-role creds missing or bucket not provisioned |
| `pipeline_error` | yes | PDAL parsing / reprojection failure (see `error_message`) |

## Status

- Worker scaffold (FastAPI, Dockerfile, auth, schemas, registry)
- All 15 skill endpoints registered
- `clip_point_cloud` — **REAL compute**, uploads artifact to Supabase Storage
- All other compute skills — return `needs_implementation`; downstream stays blocked
- Bridge writes to `roof_measurements` only happen for fully validated geometry (enforced control-plane side)
