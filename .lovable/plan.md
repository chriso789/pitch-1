## Root cause

`hoistedTransformPackage`, `hoistedGeoToRasterTransform`, `hoistedRasterBoundsLatLng`, and `hoistedConfirmedRoofCenterPx` are declared at line 6062 but are ONLY assigned **inside the `if (!dsmCoordinateMatch)` failure branch** (lines 6351–6360 in `supabase/functions/start-ai-measurement/index.ts`).

For runs that pass the DSM coordinate match gate (the Fonsica case — DSM coords match, then it preempts during Phase 3A.5 or the autonomous topology solver), control never enters that branch, so the three downstream `buildPreTopologyDebugBag(...)` call sites at lines 6728, 6765, and 7244 receive `transformPackage: null`, `geoToRasterTransform: null`, `rasterBoundsLatLng: null`.

The aerial graph builder's `resolveRasterRegistration` then has nothing to read → `executed: false`, `skipped_reason: "raster_transform_unavailable"`.

This is a single-writer ordering bug, not a multi-writer precedence bug. There is exactly one canonical writer (`buildPreTopologyDebugBag` → `buildAerialCandidateGraph`), and exactly one persistence path (`persistCpuBudgetTerminalFailure` → `buildCpuBudgetTerminalDebugPayload`). The fix is to make sure the canonical writer always has its inputs.

## Scope (what changes, what doesn't)

Patch only:

- Registration-package hoist ordering in `start-ai-measurement/index.ts` (lift the build out of the failure-only branch).
- A small merge-precedence guard in `buildCpuBudgetTerminalDebugPayload` so an executed graph can never be downgraded by a later skipped graph passed in `incoming`.
- A Fonsica-shaped hard assertion at the top of `buildAerialCandidateGraph`: if all four inputs are present, `raster_transform_unavailable` is unreachable — only `edge_construction_failed` is a legal skip reason.

Do NOT touch:

- DSM solver (`solveAutonomousGraph`)
- Geometry scoring / `customer_report_ready` gating
- Overlay transforms (`overlayCoordinateFrame.ts`)
- DB schema / `result_state` normalizer
- Canonical route (`start-ai-measurement` only)

## Implementation

### 1. `supabase/functions/start-ai-measurement/index.ts`

**a. Unconditional early hoist** (immediately after the `let hoisted*` declarations near line 6065, BEFORE the DSM coordinate match gate at line 6069):

Build a registration package using whatever transforms are already available at this point (raster bounds from the satellite acquisition step, geo→raster transform from `buildRegistrationTransformPackage`, confirmed center from input). Assign:

```text
hoistedTransformPackage         = pkg
hoistedGeoToRasterTransform     = pkg.geo_to_raster_transform
hoistedRasterBoundsLatLng       = pkg.raster_bounds_lat_lng
hoistedConfirmedRoofCenterPx    = pkg.confirmed_roof_center_px
```

The existing assignment inside the `!dsmCoordinateMatch` branch (lines 6351–6360) stays as a refinement (it can overwrite with a DSM-aware package), but the early hoist guarantees a non-null value before any preempt checkpoint.

**b. Assertion guard** before each of the three `buildPreTopologyDebugBag` calls (6728, 6765, 7244): if `hoistedTransformPackage == null`, log a `[AERIAL_GRAPH_HOIST_MISSING]` line with the call-site tag so we catch any future regressions in production logs.

### 2. `supabase/functions/_shared/pre-topology-debug-bag.ts`

In `buildCpuBudgetTerminalDebugPayload` (line 454), replace the unconditional pass-through at line 472 with a merge guard:

```text
const incomingGraph = incoming.aerial_candidate_roof_graph
const freshGraph    = (built from incoming.* and registration fields)
const aerialCandidateRoofGraph =
    incomingGraph?.executed === true ? incomingGraph
  : freshGraph?.executed === true    ? freshGraph
  : freshGraph ?? incomingGraph
```

In practice the upstream `buildPreTopologyDebugBag` already produces the canonical graph and hands it in as `incoming.aerial_candidate_roof_graph`, so this is a belt-and-suspenders guard ensuring no future caller can downgrade an executed graph.

### 3. `supabase/functions/_shared/aerial-candidate-graph.ts`

At the top of `buildAerialCandidateGraph` (after `resolveRasterRegistration` + `resolvePerimeterRingPx`), add a Fonsica-shaped assertion:

```text
if (reg.geoToRasterTransform && reg.rasterBoundsLatLng
    && ringPx && (eaves.length > 0 || perimeterEdges.length > 0)) {
  // raster_transform_unavailable is impossible by definition.
  // If we still hit it below, that's a programmer error — throw.
}
```

`skip_debug` is already always populated on every skipped return — that part is verified in the current source.

### 4. Tests (Deno)

Per the AI Measurement Regression Harness skill, add fixtures and tests before claiming the fix.

Fixtures under `supabase/functions/_shared/__fixtures__/`:

- `fonsica-pre-topology-bag-input.json` — captured shape with `transformPackage`, `perimeterTopology.perimeter_ring_px`, `eave_edges`, `target_mask_isolation.checked=true`.

New tests under `supabase/functions/start-ai-measurement/__tests__/`:

- `aerial-graph-fonsica-shaped-input.test.ts`
  - Asserts: given Fonsica-shaped input → `aerial_candidate_roof_graph.executed === true`, `edges.length >= 6`, `skipped_reason` undefined.
- `aerial-graph-hoist-survives-dsm-match.test.ts`
  - Asserts: with `dsmCoordinateMatch === true`, the registration package is still passed into `buildPreTopologyDebugBag` (mock the call and inspect args).
- `aerial-graph-merge-precedence.test.ts`
  - Asserts: `buildCpuBudgetTerminalDebugPayload` never downgrades an executed graph to a skipped graph, and every skipped graph carries `skip_debug`.

### 5. Acceptance on next Fonsica rerun

Persisted row must show:

- `aerial_candidate_roof_graph.executed === true`
- `aerial_candidate_roof_graph.edges.length >= 6`
- `aerial_candidate_roof_graph.skipped_reason` absent
- `primary_geometry_source === "aerial_registered"`
- `dsm_validation_status.reason === "invalid_transform"` (or `null` if DSM is good)
- overlay still aligned (no regression in `transform_package` precedence)
- `customer_report_ready === false`

## Files touched

- `supabase/functions/start-ai-measurement/index.ts` — early unconditional registration hoist + assertion logs
- `supabase/functions/_shared/pre-topology-debug-bag.ts` — merge-precedence guard in `buildCpuBudgetTerminalDebugPayload`
- `supabase/functions/_shared/aerial-candidate-graph.ts` — Fonsica-shaped impossibility assertion
- `supabase/functions/_shared/__fixtures__/fonsica-pre-topology-bag-input.json` — new
- `supabase/functions/start-ai-measurement/__tests__/aerial-graph-fonsica-shaped-input.test.ts` — new
- `supabase/functions/start-ai-measurement/__tests__/aerial-graph-hoist-survives-dsm-match.test.ts` — new
- `supabase/functions/start-ai-measurement/__tests__/aerial-graph-merge-precedence.test.ts` — new

No DSM solver, no geometry gate, no schema, no customer-report changes.  
  
This plan is correct. This is the clearest root-cause analysis Lovable has produced so far.

The important realization is:

```

```

```
This is NOT a geometry problem anymore.
This is NOT a DSM problem anymore.
This is NOT an overlay problem anymore.
```

It is:

```

```

```
A registration-package hoist ordering bug.
```

And the evidence fully supports that.

# Why this diagnosis is correct

The current report proves:

-   
raster registration exists  

-   
geo_to_raster_transform exists  

-   
raster bounds exist  

-   
perimeter ring exists  

-   
perimeter edges exist  

-   
eave edges exist  

-   
overlay alignment is correct  

-   
target mask isolation works  


BUT:

```

```

```
aerial_candidate_roof_graph.executed = false
skipped_reason = raster_transform_unavailable
```

That can only happen if the graph builder is receiving a stale/null registration object.

The plan correctly explains why:

```

```

```
hoistedTransformPackage and related raster fields
are only assigned inside the !dsmCoordinateMatch branch.
```

Fonsica does not go through that branch anymore.

So the graph builder receives:

-   
null transform package  

-   
null raster bounds  

-   
null geo_to_raster_transform  


even though those fields exist later in the payload.

That perfectly matches the observed behavior.

# The most important part of the fix

This is the critical line in the plan:

```

```

```
Build the raster registration package BEFORE the DSM coordinate match gate.
```

That is the right architecture.

Because:

```

```

```
registered aerial geometry must not depend on DSM validity
```

That is the whole point of the aerial-primary pivot.

# The only thing I would reinforce

The plan is already strong, but I would add one explicit requirement:

## The early hoist MUST be DSM-independent

Meaning:

The early registration package must be considered valid if it has:

-   
geo_to_raster_transform  

-   
raster_bounds_lat_lng  

-   
raster_size_px  

-   
confirmed_roof_center_px  


even if ALL DSM fields are null.

That means this is acceptable:

```

```

```
{
  "geo_to_dsm_transform": null,
  "dsm_tile_bounds_lat_lng": null,
  "dsm_to_raster_transform": null,
  "confirmed_roof_center_dsm_px": null
}
```

while still allowing:

```

```

```
aerial_candidate_roof_graph.executed = true
```

That distinction matters enormously.

# The expected outcome after deploy

The next Fonsica pull should finally show:

```

```

```
aerial_candidate_roof_graph.executed = true
```

with:

-   
perimeter ring  

-   
candidate edges  

-   
corner nodes  

-   
raster_registered = true  

-   
primary_geometry_source = aerial_registered  

-   
dsm_validation_status = invalid_transform  


while still correctly showing:

```

```

```
customer_report_ready = false
```

That is the correct intermediate state.

# This is the first time the architecture actually looks coherent

Now the layers are finally separating correctly:

## Aerial registration layer

works

## Perimeter extraction layer

works

## Candidate graph layer

almost works

## DSM validation layer

still failing

## Customer report layer

correctly blocked

That is exactly how this system should evolve.

You are finally debugging isolated subsystems instead of fighting total architectural collapse.