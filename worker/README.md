# PITCH Measure Internal Worker

First-party Python compute service for PITCH Measure. Owns the heavy
geospatial skills (PDAL / GDAL / Open3D / Rasterio) that cannot run inside
Supabase Edge Functions (Deno).

This service is **internal** — it is not a third-party vendor. It is
dispatched to by the Lovable/Supabase control plane (`measurement-worker`
edge function) and writes artifacts back to Supabase Storage + the
`mskill_*` tables.

## Architecture

```
Lovable/Supabase (control plane)
        │
        │  POST /skills/<name>  (X-Internal-Worker-Api-Key)
        ▼
Python FastAPI worker (this service)
        │
        ├── PDAL / laspy / Open3D / GDAL compute
        ├── Writes artifacts → Supabase Storage
        └── POST callback → measurement-worker /worker/callback
```

## Stack

- Python 3.11+
- FastAPI + Uvicorn
- Pydantic v2
- PDAL, GDAL, Rasterio, laspy
- NumPy, SciPy, scikit-image
- Shapely, GeoPandas
- Open3D
- supabase-py

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET  | `/health` | liveness |
| GET  | `/capabilities` | declared skill list + versions |
| POST | `/skills/clip-point-cloud` | **implemented** — clip LAS/LAZ/COPC/EPT to AOI |
| POST | `/skills/generate-dsm` | DSM from first/highest returns |
| POST | `/skills/generate-dtm` | DTM from ground returns |
| POST | `/skills/generate-chm` | CHM = DSM − DTM |
| POST | `/skills/isolate-roof-points` | mask roof points |
| POST | `/skills/fit-roof-planes` | RANSAC plane fit |
| POST | `/skills/detect-ridges` | plane-plane high intersections |
| POST | `/skills/detect-hips` | exterior sloped intersections |
| POST | `/skills/detect-valleys` | interior low intersections |
| POST | `/skills/detect-eaves` | low perimeter edges |
| POST | `/skills/detect-rakes` | sloped gable edges |
| POST | `/skills/calculate-pitch` | plane normal → rise/12 |
| POST | `/skills/calculate-roof-area` | slope-adjusted facet area |
| POST | `/skills/validate-geometry` | QA gates |
| POST | `/skills/export-report` | JSON + GeoJSON + PDF |

## Environment

Standardized names — match the control plane:

```
INTERNAL_WORKER_API_KEY=...     # shared secret with control plane
WORKER_MODE=development         # development | production
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_STORAGE_BUCKET=mskill-artifacts
MAX_AOI_SQFT=200000
MAX_POINT_COUNT=50000000
MIN_CLIPPED_POINT_COUNT=500
MAX_DOWNLOAD_MB=2048
TEMP_WORK_DIR=/tmp/pitch-measure
```

Legacy `WORKER_API_KEY` is still read as a fallback.

## Run locally

```bash
cd worker
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8080
curl http://localhost:8080/health
curl http://localhost:8080/capabilities
```

## Status

`clip_point_cloud` performs real PDAL compute and uploads a clipped LAZ
to Supabase Storage. All other skill endpoints accept the canonical
payload, validate it, and return `status: "needs_implementation"` with
`qa_flags: ["stub"]`. Control plane MUST NOT mark a `skill_run` as
`completed` from a stub response — only real artifacts unblock downstream
skills.

## Guardrails (do not violate)

- DEM/DTM alone cannot produce roof planes. DSM or point cloud required.
- Building footprint is wall-line only — not roof eaves.
- Roof edge candidates are not final until validated.
- No stub/deferred output unblocks downstream skills.
- Paid providers stay disabled unless explicitly enabled by tenant.
- Every artifact stamped with `request_hash` + `measurement_request_id`.
