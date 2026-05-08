
# AI Measurement: Backbone-First Topology Rebuild + Vendor Benchmark Gate

## Context

The Fonsica 4063 measurement exposes a fundamental structural flaw: the solver produces 6 facets instead of 14, zero ridges, a collapsed 1.67/12 pitch, and cross-roof diagonal hips. The perimeter is within ~35 LF but the internal topology is structurally wrong. The existing backbone-network.ts (v17) suppresses some diagonals but the core issue is that planes are still derived from DSM plane segmentation rather than from a ridge/valley skeleton.

## Files to modify

- `supabase/functions/_shared/backbone-network.ts` — Major rewrite: backbone-first assembly decomposition with local assembly preservation, cross-roof diagonal rejection, and deferred edge reintroduction
- `supabase/functions/_shared/autonomous-graph-solver.ts` — Wire backbone-first flow, add ridge_network_missing gate, add cross-roof span_ratio rejection, add vendor benchmark gate, improve pitch fallback
- `supabase/functions/start-ai-measurement/index.ts` — Pitch fallback hardening, mask component merging for perimeter, vendor benchmark comparison gate, persist new diagnostics

## Changes

### 1. Perimeter mask component merging (index.ts)

Before final contour tracing, merge nearby roof-mask connected components if:
- Component is within 8-12px of main component
- Component aligns with visible roof boundary direction
- Merging increases perimeter without adding non-roof area

Persist: `merged_mask_components_count`, `perimeter_length_before_merge`, `perimeter_length_after_merge`, `eave_rake_delta_after_merge`.

### 2. Pitch source hardening (index.ts, ~line 4045-4068)

Current code already falls back to Solar when `isBadTopology` but the condition checks `facetCountForPitch <= 3`. The Fonsica case has 6 facets, which doesn't trigger it. Fix:
- Add condition: `facetCountForPitch < expected_min_facets` (from topology fidelity)
- Add condition: `rawDominantPitch < 2` (anything below 2/12 on a non-flat roof is nonsense)
- Never output pitch from collapsed planes when topology_fidelity is "low" or "medium"

### 3. Backbone-first topology reconstruction (backbone-network.ts)

Rewrite the flow from "filter bad edges" to "build structure first":

1. Extract ridge/valley candidate lines from DSM edge detection
2. Build ridge chains and valley chains (existing logic, improved)
3. Identify local assemblies from chain endpoints + footprint corners
4. Each assembly gets its own local hip edges connecting ridge/valley endpoints to nearest footprint corners
5. Faces are derived from the backbone graph, not from DSM planes

Key additions:
- `buildLocalAssemblies()` — partition footprint into sub-regions based on backbone endpoints
- `deriveHipsFromBackbone()` — connect ridge/valley endpoints to footprint corners within each assembly
- Deferred edges (short structural edges rejected by length) are reintroduced if they split an oversized plane or improve ridge/valley continuity

### 4. Cross-roof diagonal suppression (autonomous-graph-solver.ts)

In the planar solver input stage, reject any interior edge where:
- `span_ratio > 0.50` (edge length / roof diagonal)
- Edge crosses more than one local assembly boundary
- Edge would create a face > 35% of total roof area
- Edge suppresses local valleys/ridges that have DSM evidence

Current: `DIAGONAL_SPAN_RATIO_MAX = 0.50` exists in backbone-network.ts but doesn't fully suppress Fonsica's 0.757 diagonal. The check needs to run after face generation too, rejecting faces that are too large.

### 5. Mandatory ridge detection gate (autonomous-graph-solver.ts)

Add hard fail `ridge_network_missing` when:
- `ridge_lf === 0` AND `facets >= 4`
- Solar data indicates multiple opposing roof segments (>1 azimuth cluster)
- Complexity flag is set

This prevents the current scenario where a complex hip roof reports zero ridges.

### 6. Deferred edge reintroduction (autonomous-graph-solver.ts)

Score-rejected and length-rejected edges are already tracked as `scoreRejectedEdgesPx`. After initial face extraction:
- If `max_plane_area_ratio > 0.35` or `facet_count < expected_min_facets`, attempt to reintroduce deferred edges
- Accept reintroduced edge if it: aligns with DSM extrema, improves ridge/valley continuity, reduces max plane area, increases facet count
- This is the existing v15 refinement pass but with the additional trigger of "facet count too low"

### 7. Vendor benchmark gate (index.ts)

New table or JSON field for known benchmark addresses. For addresses with paid vendor reports, compare AI output:
- `area_delta_pct`, `facet_delta`, `pitch_delta`, `ridge_delta_pct`, `hip_delta_pct`, `valley_delta_pct`, `eave_delta_pct`
- `topology_score_vs_vendor` = weighted composite

Block `customer_report_ready` if:
- Facet count off > 25%
- Pitch off > 1/12
- Ridge/hip/valley totals off > 25%
- `ridge_lf = 0` on complex roof
- `topology_score_vs_vendor < 80`

Store benchmark data in `roof_measurement_benchmarks` table (migration needed).

### 8. Topology fidelity improvements (autonomous-graph-solver.ts)

In `analyzeTopologyFidelity()`:
- Add `expected_min_facets` check using Solar segment count as a floor
- Add `ridge_missing_on_complex_roof` flag
- Report `cross_roof_diagonal_span_ratios` for each interior edge
- Lower the `fanCollapseSuspected` threshold when combined with zero ridges

### 9. Deploy and re-run Fonsica

After implementation, deploy the updated edge function and trigger a new measurement for 4063 Fonsica Ave. Expected outcomes:
- Pitch returns near 6/12 (from Solar fallback at minimum)
- Facet count increases toward 14
- Ridges become non-zero
- Cross-roof diagonals are rejected
- Report remains blocked until vendor benchmark passes

## Migration

One new table:
```sql
CREATE TABLE roof_measurement_benchmarks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  address TEXT NOT NULL,
  lat DECIMAL(10,8),
  lng DECIMAL(11,8),
  vendor TEXT NOT NULL DEFAULT 'roofr',
  vendor_report_id TEXT,
  area_sqft DECIMAL(10,2),
  facets INTEGER,
  pitch_rise_per_12 DECIMAL(5,2),
  eave_lf DECIMAL(10,2),
  valley_lf DECIMAL(10,2),
  hip_lf DECIMAL(10,2),
  ridge_lf DECIMAL(10,2),
  rake_lf DECIMAL(10,2),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

Seed Fonsica benchmark:
```sql
INSERT INTO roof_measurement_benchmarks (address, vendor, area_sqft, facets, pitch_rise_per_12, eave_lf, valley_lf, hip_lf, ridge_lf, rake_lf)
VALUES ('4063 Fonsica Ave', 'roofr', 3077, 14, 6.0, 258.75, 64.25, 201.83, 30.17, 5.25);
```

## Technical risk

The backbone-first reconstruction is a significant algorithmic change. The main risk is regression on simpler roofs (simple gables/hips) that currently work. Mitigation: the backbone flow only activates when complexity flags are set OR facet deficit is detected. Simple roofs continue through the existing path.
