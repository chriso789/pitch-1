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
│   │   ├── auth.py                     # WORKER_API_KEY guard
│   │   └── config.py
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
POST  https://<worker>/skills/<name>
      X-Worker-Api-Key: $WORKER_API_KEY
      body: SkillRequest
   ▼
Worker:
  1. validate payload (Pydantic)
  2. download source_url to TEMP_WORK_DIR
  3. compute (PDAL/Open3D/...)
  4. upload artifacts → Supabase Storage (mskill-artifacts/<tenant>/<job>/...)
  5. return SkillResponse with artifact pointers + qa_flags
   ▼
measurement-worker writes mskill_artifacts rows, advances skill_run.status
   • status="completed"  → only with real artifacts
   • status="needs_implementation" or qa_flags includes "stub" →
       skill_run stays "requires_internal_worker", downstream BLOCKED
```

## Skills (compute plane)

See `worker/app/skills_registry.py` for the canonical list. Every entry
maps 1:1 to a row in `mskill_registry` on the control plane. The 15
compute skills are: clip_point_cloud, generate_dsm, generate_dtm,
generate_chm, isolate_roof_points, fit_roof_planes, detect_ridges,
detect_hips, detect_valleys, detect_eaves, detect_rakes,
calculate_pitch, calculate_roof_area, validate_geometry, export_report.

## Hard guardrails

1. **No fake completion.** Control plane refuses to promote a skill_run
   to `completed` when the response has `status="needs_implementation"`
   or `qa_flags` contains `"stub"` / `"no_real_compute"`.
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
docker compose up --build measure-worker
curl http://localhost:8080/health
curl http://localhost:8080/capabilities | jq
```

Point the control plane at it with:

```
MSKILL_WORKER_BASE_URL=http://host.docker.internal:8080
INTERNAL_WORKER_SECRET=<same as worker WORKER_API_KEY>
```

## Status

- ✅ Worker scaffold (FastAPI, Dockerfile, auth, schemas, registry)
- ✅ All 15 skill endpoints registered, returning `needs_implementation`
- ✅ Shared JSON Schemas in `shared/measurement-contracts/`
- ⛔ No compute implemented yet — by design
- ⛔ No bridge writes to `roof_measurements` from stub output (control
   plane already enforces)
