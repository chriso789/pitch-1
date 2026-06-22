## PR #4 — Evidence Hardening (Vendor-Free)

Goal: make footprint + imagery acquisition reliable enough that the AI measurement pipeline never needs a vendor report as input or fallback. Every run records exactly which evidence source it used and how confident that source was, so downstream gates (perimeter, topology, pitch) can reason about evidence quality instead of silently degrading.

This is the foundation for PR #5 (self-consistent pitch) and PR #6 (self-distilled UNet) — both depend on knowing the evidence source per job.

---

### Scope

**In scope**
1. Fix Google Solar API 403 (infra remediation + in-code guardrails)
2. Add Microsoft Building Footprints as Tier-1 footprint source
3. Add county parcel data as Tier-2 footprint source
4. Persist `evidence_source_used` (per layer) + per-source confidence on every measurement job
5. Surface evidence-source diagnostics in the measurement debug panel
6. Optional Nearmap/Vexcel orthophoto hook (per-tenant) when Solar resolution < 0.15 m/px — wired but not enabled by default

**Out of scope (later PRs)**
- Per-facet DSM plane-fit pitch (PR #5)
- Oblique imagery verification (PR #5)
- UNet training (PR #6)
- Self-consistency score gate (PR #7)
- Sellable PDF report layout (PR #8)

---

### Technical changes

**Database**
- Migration adds to `ai_measurement_jobs` and `measurement_jobs`:
  - `evidence_sources_used jsonb` — `{ footprint: {source, confidence, fetched_at}, dsm: {...}, mask: {...}, orthophoto: {...}, solar_segments: {...} }`
  - `footprint_source_tier text` — `tier1_osm | tier1_ms_footprints | tier2_parcel | tier3_solar_mask | tier4_unet | none`
  - `evidence_acquisition_log jsonb` — ordered list of each source attempted with status/latency/error
- New table `tenant_imagery_providers` for optional Nearmap/Vexcel per-tenant credentials (RLS: tenant-scoped, master-managed)

**Shared helpers (`supabase/functions/_shared/`)**
- `evidence-acquisition.ts` — orchestrator that runs the cascade and returns `{ footprint, dsm, mask, orthophoto, solar_segments, evidence_sources_used, acquisition_log }`
- `fetch-ms-footprints.ts` — Microsoft Building Footprints fetcher (quadkey tile → polygon nearest to target)
- `fetch-parcel.ts` — county parcel fetcher (Regrid/ArcGIS REST fallback)
- `solar-api-client.ts` — hardened Solar client: detects 403 vs 404 vs quota, surfaces `solar_api_unavailable` reason, never silently falls through

**Edge function changes**
- `start-ai-measurement`: replace inline footprint cascade with `acquireEvidence()` call; persist `evidence_sources_used` + `footprint_source_tier` + `evidence_acquisition_log` on the job row; remove any legacy "vendor report as input" code paths
- Remove `roof_measurement_benchmarks` runtime read (offline-audit only going forward)

**Frontend**
- `DSMDebugOverlay`: new "Evidence Sources" panel listing each layer, source, confidence, and acquisition latency
- `UnifiedMeasurementPanel`: badge next to status showing footprint source tier (e.g. "MS Footprints · 0.94")

**Secrets**
- `MS_BUILDINGS_BASE_URL` (public dataset, no key — but URL configurable)
- `REGRID_API_KEY` (optional, for parcel Tier-2)
- Solar key already exists — needs Cloud Console fix outside this PR; code handles missing/403 gracefully

**Memory updates**
- Remove `Vendor Benchmark Gate` and `Backbone-First v18 + Vendor Benchmark` runtime-gate rules from core memory
- Add core rule: "Evidence-free runs are hard fails. Every job persists `evidence_sources_used` + `footprint_source_tier`. Vendor reports are never inputs."

---

### Acceptance criteria

- Every new `ai_measurement_jobs` / `measurement_jobs` row has non-null `evidence_sources_used` and `footprint_source_tier`
- Solar 403 produces `solar_api_unavailable` in `acquisition_log`, never a silent OSM-only fallback masquerading as full-evidence
- MS Building Footprints is attempted before `google_solar_mask_contour` in the cascade
- Parcel fetch runs only when Tier-1 yields no candidate within 30 m of target
- Debug panel shows the per-layer source for the most recent job
- No code path reads from `roof_measurement_benchmarks` at runtime
- Existing customer-report-ready gates (six contracts + four hard gates) remain unchanged

---

### Build order

1. Migration (schema + `tenant_imagery_providers`)
2. `evidence-acquisition.ts` + per-source fetchers (unit-testable in isolation)
3. Wire `start-ai-measurement` to the new orchestrator
4. Frontend debug surface
5. Memory cleanup (remove vendor-benchmark runtime rules)

After PR #4 lands, next is PR #5 — Self-Consistent Pitch Verification (per-facet DSM plane-fit + Street View edge-angle cross-check).

---

Approve and I'll start with the migration.