
## Problem

Latest edge function logs confirm: 12 validated faces exist, but **all ridges are misclassified as hips** by the DSM perpendicular profile sampler. The failure waterfall then kills the measurement. Result: valid geometry exists but official totals are zero.

Root causes:
1. `classifyEdgeByDSM` samples perpendicular to edges near roof boundaries, hitting ground elevation on one side. A 13m drop looks like `leftRises && rightDrops` → hip. Actual ridges get misclassified.
2. The failure waterfall at line 1236 of `index.ts` triggers `invalid_edge_classification` when `hip_ft > 50` on complex roofs, even though faces are validated.
3. No face-adjacency reclassification exists — the system relies solely on DSM perpendicular profiles which are unreliable near roof boundaries.

## Changes

### 1. Mask-Aware DSM Edge Classification (`dsm-utils.ts`)

**`getPerpendicularProfile`**: Add mask awareness and ground-drop detection:
- Track whether each perpendicular sample lands on the roof mask (`MaskedDSMGrid.mask`)
- Compute `leftOnRoof` / `rightOnRoof` flags (>50% of samples on mask = on roof)
- Compute `leftGroundDrop` / `rightGroundDrop` flags (slope > 3m = likely ground)

**`classifyEdgeByDSM`**: Use mask awareness before classifying:
- If one side is off-roof or has ground-level drop: classify using only the valid side
  - Valid side slopes down → **ridge** (edge is peak)
  - Valid side slopes up → **eave** (edge is boundary)
- If both sides are off-roof → return null (ambiguous)
- Standard classification only when both sides are confirmed on-roof

### 2. Face-Adjacency Edge Reclassification (`autonomous-graph-solver.ts`)

Add a new step **after** face extraction and **before** totals computation:

For each output edge shared by two validated faces:
- Get plane normal (slopeX, slopeY from `fitPlaneWithPitch`) for each adjacent face
- Compute each face's downslope vector projected perpendicular to the shared edge
- Classify based on slope direction relative to the edge:
  - **Ridge**: both faces descend away from the shared edge
  - **Valley**: both faces ascend toward the shared edge  
  - **Hip**: faces slope in different lateral directions but no peak/trough
- For edges with only one adjacent face on the footprint boundary → **eave/rake**

This is the primary classification. DSM perpendicular profile is secondary evidence.

### 3. Fix Failure Waterfall (`start-ai-measurement/index.ts`)

Current logic at lines 1236-1244:
```
hip_ft > 50 && complexity.isComplex → invalid_edge_classification
```
This fires after face-adjacency fixes ridge classification. But also:

- **Decouple face validation from edge classification**: If `graph.faces.length >= 2` and `face_coverage_ratio >= COVERAGE_RATIO_MIN`, the geometry is valid regardless of edge type distribution
- Remove the `ai_failed_complex_topology` check when `graph.faces.length >= 4` (validated faces prove topology is not failed)
- Only trigger `invalid_edge_classification` when there are truly 0 structural edges AND faces exist

### 4. Totals Aggregation Fix (`start-ai-measurement/index.ts`)

Lines 1176-1180 gate validated totals on `graphValidated`:
```typescript
validated_faces: graphValidated ? graph.faces.length : 0
validated_ridge_lf: graphValidated ? attemptedRidgeLf : 0
```

Fix: When `graph.faces.length >= 2` and `face_coverage_ratio >= 0.5`, use the actual graph totals even if `validation_status !== "validated"` due to edge classification issues. Faces with valid plane fits should always contribute to totals.

### 5. Honest Coordinate Space Metadata (`start-ai-measurement/index.ts`)

The solver output is in geo `[lng, lat]`, not DSM pixel space. Fix the metadata:
- `coordinate_space_output: "geo"` (truth)
- `coordinate_space_solver_internal: "dsm_px"` (steps 6-7 use pixel space)
- Persist both `edges_geo` and `edges_dsm_px` in the debug payload (already partially done)

## Files Modified

| File | Changes |
|------|---------|
| `supabase/functions/_shared/dsm-utils.ts` | Mask-aware `getPerpendicularProfile` + ground-drop guard in `classifyEdgeByDSM` |
| `supabase/functions/_shared/autonomous-graph-solver.ts` | Add `reclassifyEdgesByFaceAdjacency()` step after face extraction using plane normals |
| `supabase/functions/start-ai-measurement/index.ts` | Fix failure waterfall, decouple totals from edge classification, fix coordinate metadata |

## Expected Result

Next AI Measurement run should produce:
- Non-zero ridge/hip/valley totals from validated geometry
- Edges classified by face-adjacency (primary) with DSM profile (secondary)
- No `invalid_edge_classification` failure when faces are validated
- Honest `coordinate_space_output: "geo"` metadata
