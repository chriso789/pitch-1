## Plan: 4 parallel tracks

Each track is independently shippable. Order is recommended but not required.

---

### Track 1 — Fonsica rerun + `debug-measurement-runtime` capture

**Goal:** Prove the canonical route stamps + Phase 3 wiring actually fire end-to-end on a real failed-perimeter lead, and that legacy writers do NOT get mistaken for AI.

Target lead: `0a38230e-57ad-4f22-9caa-ac7707a6962f` (4063 FONSICA AVE). Last 3 runs all `ai_failed_perimeter` with `hard_fail_reason = null` — so the new `hard_fail_reason` column is still empty for that path, which is itself a finding.

Steps:
1. Call `start-ai-measurement` for the Fonsica lead (master JWT) with `roof_target_admin_override=true` to skip Patent Rule 1 PIN if needed.
2. Poll `ai_measurement_jobs` for the new row; wait until `result_state != 'processing'`.
3. Call `debug-measurement-runtime` against the new job ID and persist the response to `docs/fonsica-rerun-<timestamp>.json`.
4. Verify checklist (all must be true on the new row):
   - `canonical_measurement_route = true`
   - `created_by_function = 'start-ai-measurement'`
   - `route_provenance.route_audit_version = 'measurement-route-audit-v1'`
   - `phase3_5.version`, `phase3C.version`, `phase3D.version`, `phase3E.version` all populated
   - each phase has `executed=true` or a `skipped_reason`
   - failure (if any) is stage-correct: `perimeter_refinement_failed` / `backbone_not_applied` / `topology_undersegmented_after_backbone_repair` — copied into `hard_fail_reason`, not just `result_state`
5. If any phase is missing or `hard_fail_reason` is still null on a failure, file findings in `docs/fonsica-rerun-<timestamp>.md` and fix the wiring before moving on.

Deliverable: the rerun JSON + a one-page pass/fail report.

---

### Track 2 — Legacy provenance stamp on remaining measurement writers

**Scope correction from the prior message:** only functions that actually INSERT/UPDATE `roof_measurements`, `ai_measurement_jobs`, or `measurement_jobs` need the stamp. From the codebase:

- Writes measurement tables → must stamp `LEGACY_<NAME>_PROVENANCE`:
  - `generate-roof-report`
  - `ai-measurement`
  - `recalculate-measurement-from-overrides` (already canonical-aware — confirm it does not overwrite `created_by_function`)
- Read-only or downstream artifacts (no stamp needed, but add a header comment confirming "non-writer"):
  - `generate-roof-overlay`, `generate-roof-line-overlay`, `calculate-roof-measurements`, `auto-generate-measurements`, `batch-regenerate-measurements`, `batch-remeasure`, `trace-roof`, `ai-measurement-analyzer`, `analyze-roof-aerial`, `extract-roof-plan-geometry`, `parse-roof-report`, `roof-report-ingest`, `render-measurement-pdf`, `compare-ai-measurement-to-vendor`, `score-roof-accuracy`, `track-measurement-accuracy`, `validate-measurement`, `run-measurement-benchmark`, `measurement-calibration`, `measurement-learning-loop`, `measurement-worker`, `delete-ai-measurements`, `detect-roof-obstruction`, `generate-measurement-visualization`

Pattern (matches existing `measure-roof`):
```ts
const LEGACY_<NAME>_PROVENANCE = {
  created_by_function: '<fn-name>',
  canonical_measurement_route: false,
  route_warning: 'legacy_writer_do_not_treat_as_ai',
  route_audit_version: 'measurement-route-audit-v1',
};
// merged into every INSERT and into update payloads' route_provenance
```

Verification: after deploy, `SELECT created_by_function, canonical_measurement_route, count(*) FROM roof_measurements GROUP BY 1,2` — every row must have a non-null `created_by_function`.

---

### Track 3 — Tenant-prefix upload fix on remaining surfaces

Apply the same `useEffectiveTenantId` + `{tenantId}/...` + `safeStorageUpload` pattern already used in `DocumentsTab.tsx`. Confirmed call sites still missing the prefix:

| File | Line | Bucket / Notes |
|---|---|---|
| `src/components/ApprovalRequirementsBubbles.tsx` | 264, 425 | two upload paths |
| `src/components/photos/LeadPhotoUploader.tsx` | 199 | already compresses — only path needs fix |
| `src/components/estimates/PaymentsTab.tsx` | 208 | currently `temp/${fileName}` — must become `{tenantId}/payments/...` |
| `src/components/inspection/InspectionWalkthrough.tsx` | 215 | walkthrough photos |
| `src/components/templates/TemplateVendorQuotes.tsx` | 98 | vendor quote PDFs |
| `src/features/reviews/components/VideoTestimonialCapture.tsx` | 82 | review videos |
| `src/components/estimates/EstimatePreviewPanel.tsx` | 619 | estimate attachments |
| `src/services/documentationGenerator.ts` | 409 | generated docs |
| `src/components/ai-admin/AIAdminChat.tsx` | 251 | admin chat images |
| `src/components/admin/PortalUserDetail.tsx` | (verify) | portal user assets |
| `src/pages/BlueprintPageReview.tsx` | (verify) | blueprint review uploads |
| `src/components/materials/BulkInvoiceImportDialog.tsx` | (verify) | invoice imports |
| `src/components/documents/DocumentPreviewModal.tsx` | (verify) | preview-time uploads |
| `src/components/presentations/SlideRenderer.tsx` | (verify) | slide assets |

For each: read the file, resolve `tenantId = useEffectiveTenantId()`, refuse upload if missing, build `${tenantId}/<feature>/<id>/${ts}.<ext>`, route through `safeStorageUpload`, and use the same `tenantId` on any companion DB insert. No business-logic changes.

Out of scope: any new bucket creation or RLS policy edits — buckets already enforce the contract.

---

### Track 4 — Edge function consolidation (real route logic)

The three router shells (`supplier-api`, `signature-api`, `measurement-api`) all return 501 `not_migrated` today. Migrate logic from the legacy one-off functions into the router handlers, keeping the legacy function deployed as a thin shim that calls the router (so existing client code keeps working during rollout).

#### 4a — `supplier-api`
Migrate from: `import-supplier-price-list`, `parse-supplier-quote`, `resolve-supplier-skus`, `supplier-webhook`, `supplier-worker` and the QXO/SRS/ABC/Billtrust handlers currently in scattered functions. Map to existing scaffolded routes (`/qxo/*`, `/srs/*`, `/abc/*`, `/billtrust/*`, `/pricing`, `/quote/parse`, `/material-order/*`).

#### 4b — `signature-api`
Migrate from: `capture-digital-signature`, `create-signature-envelope`, `send-signature-envelope`, `send-document-for-signature`, `email-signature-request`, `resend-signature-request`, `notify-signature-opened`, `request-quote-signature`, `signature-webhook`, `submit-signature`. Map to existing scaffolded routes (`/docusign/*`, `/envelope/*`, `/submit`, `/capture`, `/quote/request`, `/request/resend`, `/opened`, `/signer/open`, `/email/request`).

#### 4c — `measurement-api`
Migrate from: `measure-roof` (legacy path), `start-ai-measurement` (canonical — preserve provenance stamps), `ai-measurement`, `calculate-roof-measurements`, `calculate-measurement-corrections`, `recalculate-measurement-from-overrides`, `validate-measurement`, `measurement-calibration`, `compare-ai-measurement-to-vendor`, `score-roof-accuracy`, `track-measurement-accuracy`, `generate-measurement-visualization`. Map to existing scaffolded routes (`/measure`, `/ai/start`, `/ai/analyze`, `/start`, `/calculate`, `/enhanced`, `/corrections/calculate`, `/override/recalculate`, `/validate`, `/validate/perimeter`, `/calibration`, `/compare/vendor`, `/accuracy/*`, `/visualization/generate`).

Rules for migration:
1. Move logic verbatim into the route handler — no behavior changes in this pass.
2. Preserve `CANONICAL_ROUTE_PROVENANCE` (start-ai-measurement) and all `LEGACY_*_PROVENANCE` stamps from Track 2 — these must continue to fire from the router path.
3. Update each legacy function's `index.ts` to a 30-line shim that forwards to the corresponding `<api>/<route>` via `supabase.functions.invoke('<api>', { body: { __route: '<path>', ...payload } })` so existing UI imports keep working. Do not delete the legacy functions yet.
4. Update `docs/EDGE_FUNCTION_CONSOLIDATION_AUDIT.md` and the CSV after each module.
5. After each module: run `__health` + one representative route via `curl_edge_functions` to confirm parity.

Out of scope this pass: deleting legacy shims, renaming client invoke names, changing route shapes.

---

### Suggested execution order
1. Track 1 first (small, gives ground truth on whether stamps work).
2. Track 2 in parallel with Track 3 (independent files).
3. Track 4 last — biggest blast radius, benefits from Track 2's stamps already being in place.

### Technical notes
- All migrations must go through `supabase--migration` (none expected here — code-only).
- `debug-measurement-runtime` is already master/admin-gated; no policy changes needed.
- `safeStorageUpload` already exists at `src/lib/storage/safeUpload.ts` and is the only sanctioned upload helper.
- Router shells use `_shared/router.ts` `requireAuth` + `requireTenant` middleware — migrated handlers must NOT reintroduce per-handler auth.
