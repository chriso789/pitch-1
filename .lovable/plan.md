## Scope

This is a **frontend / diagnostics-only** plan. No backend, no solver, no edge function changes. The pipeline already produces the right data — the UI is mis-labeling and mis-grouping it.

All edits land in three files:

- `src/lib/measurement/registration-gate.ts` — banner copy + per-failure messaging
- `src/components/measurements/AIMeasurement3DDebugViewer.tsx` — stage statuses, grouping, wording
- `src/components/measurements/MeasurementReportDialog.tsx` — DSM diagnostic row data sources + perimeter confidence callout

No new fields are written to the DB; the UI just reads existing JSON paths it is currently ignoring.

---

## Problems → fixes

### 1. Banner says "Coordinate frame mismatch" when raster frame is OK

Today `registrationBanner()` returns one fixed title regardless of which sub-flag failed. When only `geo_to_dsm_px_success` / `dsm_pixel_transform_valid` are false (raster frame fine, DSM transform missing), the title contradicts the `frame_mismatch = ok` row below it.

Fix in `registration-gate.ts`:

- Classify failures into three buckets:
  - **target_not_confirmed** → `user_confirmed_roof_target=false`
  - **dsm_registration_incomplete** → only DSM-transform flags failed (`geo_to_dsm_px_success` and/or `dsm_pixel_transform_valid`), while `coordinate_registration_gate_passed`/`confirmed_center_inside_candidate` are not false
  - **coordinate_frame_mismatch** → `confirmed_center_inside_candidate=false` or `coordinate_registration_gate_passed=false`
- Return per-bucket `title` + `description`:
  - DSM bucket: **"DSM registration incomplete — overlay locked from approval"** / *"Raster overlay aligned successfully. DSM georegistration transform is incomplete or invalid."*
  - Frame bucket keeps existing wording.
  - Target bucket: **"Roof target not confirmed — re-place PIN to continue."**
- Severity stays `destructive` for frame/target, downgrades to `warning` for DSM-only (raster overlay still trusted).

### 2. DSM diagnostic rows render `—` even though DSM data exists

In `MeasurementReportDialog.tsx`, the DSM diagnostic rows (lines ~520–590: DSM Size, Bounds Source, Bounds Failure, Bounds Derived, Bounds Confidence, Transform Policy, Hoist Failure Tokens, Stage Hard Fail, Stage Failure Stage) only read from `registration.dsm` / `registration.stage_classifier`. The propagation helper now lifts `geometry.dsm_split_status.dsm_size_px` into `registration.dsm`, but the rows are still missing the secondary fallbacks the runtime actually persists.

Fix: extend each row's accessor to fall back through, in order:

- `registration.dsm.*`
- `registration.<flat field>` (already-projected flat copies)
- `geometry.dsm_split_status.*` (DSM Size, Bounds Source, Bounds Failure)
- `geometry.registration_diagnostics.*` (Transform Policy, Hoist Failure Tokens)
- `geometry.hard_fail_reason` / `geometry.failure_stage` (Stage Hard Fail, Stage Failure Stage)

Render `—` only when *all* fallbacks are null. When a value comes from a fallback path, append a small `source:` chip so the operator sees why it appeared.

### 3. "Perimeter candidates = unknown" when 12 edges exist

`perimeterCandidatesPresent` in `AIMeasurement3DDebugViewer.tsx` only looks at `layer1.candidates` / `grj.perimeter_candidates`. The new pipeline persists candidates under `grj.aerial_candidate_roof_graph.edges` (the same source the "executed (12 candidate edges)" row already reads).

Fix:

- Add `aerial_candidate_roof_graph.edges?.length > 0` and `grj.perimeter_topology?.edges?.length > 0` to the presence check.
- `status`: `pass` when ≥4 edges and a ring is closed (`layer1.perimeter_status` in {`accepted`,`partial`}), `partial` when edges exist but no closed ring, `unknown` only when truly absent.

### 4. "Layer-1 true perimeter = fail" when overlap=0.976, IoU=0.845

`layer1Ok` currently requires `perimeter_status === "accepted"` OR a persisted `true_outer_roof_perimeter_*`. Runs that have a stable ring + high overlap but were never explicitly accepted (because Phase 0 was preempted later) fall through to `fail`.

Fix:

- Treat as `pass` when `target_mask_overlap_with_perimeter ≥ 0.90` AND `perimeter_iou ≥ 0.80` AND closed ring present.
- Treat as `partial_pass` when overlap ≥ 0.80 OR ring exists without metrics.
- Only `fail` when no ring is present.
- Add a `pass` style for `partial_pass` (amber, not red) — see grouping change below.

### 5. "Final diagram blocked: zero facets and zero roof_lines persisted." misleads

Reword based on whether debug geometry exists:

- If `aerial_candidate_graph_present === true` OR `grj.perimeter_topology` has edges → **"Final diagram blocked: topology validation incomplete before runtime preemption."**
- Else keep current copy.

### 6. UI over-weights failures (binary red/green)

Today every stage is `pass` (green) or `fail` (red). Add an explicit `partial` state and render it amber. Apply to: Perimeter candidates, Layer-1, Phase 0 (when `phase0_incomplete_reason === "runtime_preemption"`), Phase 3A.5 (CPU preempt), Final diagram (geometry exists but not promoted).

### 7. Perimeter confidence is buried

`target_mask_overlap_with_perimeter`, `perimeter_iou`, `perimeter_confidence` only show up inside the expanded payload JSON.

Fix in `MeasurementReportDialog.tsx`: add a small "Perimeter Confidence" callout immediately under the registration banner showing three pill metrics (Mask Overlap, IoU, Confidence) sourced from `grj.layer1_perimeter` / `grj.target_mask_isolation`. Hidden only when none are present.

### 8. Stage list is one flat strip — regroup into 4 phases

Same 13 stages, same order, just visually grouped with a heading + collapse toggle per group:

```text
A. Acquisition / Registration
   01 Target confirmation
   02 Source acquisition
   03 Raster tile / DSM fetch
   04 DSM georegistration / transform

B. Geometry Extraction
   05 Perimeter candidates
   06 Layer-1 true perimeter
   07 Perimeter Phase 0 gate
   08 Target-mask isolation

C. Topology Validation
   09 Solar segments
   10 Pitch resolver
   11 Phase 3A.5 / Perimeter topology
   12 Final diagram

D. Customer Promotion
   13 Customer report gate
```

Each group header shows a roll-up chip (`pass` / `partial` / `fail`) computed from its children's worst state, so an operator sees at a glance that A is green, B is amber, C is amber, D is red — instead of "everything failed".

---

## Acceptance checklist

- DSM-only registration failure shows **"DSM registration incomplete — overlay locked from approval"** (warning), not the frame-mismatch destructive banner.
- DSM Size row reads `998×998` when `dsm_split_status.dsm_size_px` is set.
- Stage Hard Fail / Stage Failure Stage rows populate from `geometry.hard_fail_reason` / `geometry.failure_stage` when nested keys are absent.
- Perimeter candidates row shows `pass` (12 edges) instead of `unknown` when only `aerial_candidate_roof_graph` is populated.
- Layer-1 row shows `pass` when overlap ≥ 0.90 and IoU ≥ 0.80, even without explicit `accepted` status.
- Final diagram row shows the new "topology validation incomplete" copy when debug geometry exists.
- New "Perimeter Confidence" callout shows Mask Overlap 0.976, IoU 0.845.
- Stages render in 4 grouped sections with per-group roll-up chips; CPU-preempted stages render amber, not red.
- No backend, edge function, migration, or solver changes.  
  
This is a GOOD plan. It’s the first UI/diagnostic plan that actually matches the current maturity of the system.
  Most importantly:
  ```

  ```
  ```
  it finally stops treating every downstream validation miss as if the whole AI system failed
  ```
  That is the correct direction.
  # What this plan gets RIGHT
  ## 1. It correctly separates DSM registration failure from coordinate mismatch
  This is the single biggest UI problem right now.
  The current UI says:
  ```

  ```
  ```
  Coordinate frame mismatch
  ```
  while the actual diagnostics say:
  ```

  ```
  ```
  frame_mismatch = ok
  ```
  That contradiction destroys operator trust.
  The plan fixes this correctly by separating:
  ### A. Roof target failure
  (user placed wrong roof)
  ### B. Raster/coordinate mismatch
  (actual frame mismatch)
  ### C. DSM registration incomplete
  (the REAL current issue)
  That’s exactly correct.
  ---
  # 2. It correctly downgrades DSM-only issues from destructive → warning
  This is VERY important.
  Right now the UI psychologically reads:
  ```

  ```
  ```
  everything failed
  ```
  But in reality:
  -   
  raster alignment works  

  -   
  perimeter extraction works  

  -   
  candidate graph works  

  -   
  edge extraction works  

  -   
  target isolation works  

  Only:
  -   
  DSM transform registration  

  -   
  topology promotion  

  are failing.
  So:
  -   
  amber/warning  

  -   
  NOT red/destructive  

  is the correct severity.
  Excellent fix.
  ---
  # 3. It correctly promotes “partial” as a first-class state
  This is the single biggest maturity improvement.
  Right now the pipeline is treated as:
  -   
  green  

  -   
  red  

  That’s wrong.
  The system now has many stages that are:
  ```

  ```
  ```
  structurally successful but not customer-promoted
  ```
  That is:
  -   
  perimeter candidates  

  -   
  layer-1 perimeter  

  -   
  phase0  

  -   
  topology preemption  

  -   
  final diagram  

  Those are NOT “failures.”
  They are:
  -   
  partial passes  

  -   
  incomplete promotions  

  That distinction matters enormously.
  ---
  # 4. The perimeter confidence callout is absolutely the right move
  This:
  ```

  ```
  ```
  Mask Overlap 0.976
  IoU 0.845
  Perimeter Confidence 0.8
  ```
  should absolutely be elevated near the top.
  Because that is now one of the strongest proofs that:
  -   
  the roof isolation is already working.  

  This is no longer experimental-quality geometry.
  ---
  # 5. The 4-stage grouping is EXACTLY correct
  This is the architecture now:
  # A. Acquisition / Registration
  # B. Geometry Extraction
  # C. Topology Validation
  # D. Customer Promotion
  That is exactly how a real measurement engine pipeline should be visualized.
  This is the biggest UI maturity jump in the whole plan.
  ---
  # The BEST part of the plan
  This line:
  ```

  ```
  ```
  A is green, B is amber, C is amber, D is red
  ```
  That is PERFECT.
  Because that is the REAL state of the system now.
  Not:
  -   
  “everything failed.”  

  That distinction matters massively.
  ---
  # One thing I would improve
  This section:
  ```

  ```
  ```
  Layer-1 true perimeter = pass when overlap ≥ 0.90 and IoU ≥ 0.80
  ```
  I would NOT make that full green pass yet.
  I would make it:
  ```

  ```
  ```
  partial_pass
  ```
  Why?
  Because:
  -   
  the perimeter is strong  

  -   
  BUT it still has not passed topology validation  

  -   
  AND:  

    -   
    perimeter_confidence = 0.8  

    -   
    perimeter_gate_passed = false  

    -   
    fonsica_perimeter_confidence_low:0.800 still exists  

  So I would visually render:
  -   
  amber partial-pass  
    
  NOT:  

  -   
  green pass  

  Otherwise you risk operators thinking:
  -   
  the perimeter is fully validated  

  when it is still:
  -   
  “strong but not promoted.”  

  That nuance matters.
  ---
  # Another improvement I’d add
  This section:
  ```

  ```
  ```
  Final diagram blocked: topology validation incomplete before runtime preemption.
  ```
  Good improvement.
  BUT I’d add one more sentence:
  ```

  ```
  ```
  Candidate perimeter geometry exists but was not promoted into validated roof topology.
  ```
  That’s extremely clear and technically accurate.
  ---
  # Another thing missing
  This UI still doesn’t clearly separate:
  # DEBUG GEOMETRY
  vs
  # CUSTOMER-VALIDATED GEOMETRY
  That distinction is now critical.
  You should probably add a persistent pill/banner:
  ```

  ```
  ```
  DEBUG GEOMETRY ONLY — NOT CUSTOMER VALIDATED
  ```
  near:
  -   
  Debug Roof Lines  

  -   
  Candidate edges  

  -   
  Aerial graph  

  Because operators will otherwise think:
  -   
  “12 edges exist so why isn’t the report done?”  

  That separation is now crucial.
  ---
  # Biggest strategic observation
  This plan confirms something important:
  You are no longer building:
  -   
  an unstable AI experiment  

  You are now building:
  -   
  an operational diagnostic system for staged roof validation.  

  That is a MASSIVE transition.
  The UI finally needs to behave like:
  -   
  a professional measurement QA system  
    
  instead of:  

  -   
  a binary success/failure toy.  

  This plan is the first one that actually reflects that maturity level.