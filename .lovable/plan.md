
Why this is still happening:
- The diagram is not ignoring the footprint anymore; it is using a footprint, but the saved footprint is still too simple.
- The latest log shows: `Selected footprint: osm_overpass with 5 vertices (best of 1 candidates)`.
- A 5-vertex OSM polygon cannot create porch kickouts or stepped eaves, so the frontend can only draw straight boundary segments.
- The hybrid edge auto-fit only nudges existing segments; it cannot invent missing corners.
- `start-ai-measurement` sends `useUnifiedPipeline: true`, but `analyze-roof-aerial` does not read that flag, so the richer shared resolver/fusion path is being bypassed during async pulls.
- `SchematicRoofDiagram` also applies a low-quality OSM rescale/correction, which can move straight lines but still cannot create the missing kickout geometry.

Implementation plan:
1. Fix the pipeline entry point
- Make async measurement pulls actually honor the unified footprint path instead of always staying in `analyze-roof-aerial`’s Solar Fast Path.
- Reuse the shared footprint resolver/fusion logic that already exists instead of keeping a separate ad hoc selector.

2. Add a “detail gate” before saving any footprint
- Reject low-detail candidates when they have too few vertices, long straight segments, or mismatch the roof complexity implied by Solar segments/interior topology.
- If the best returned source is still simplified OSM/Microsoft geometry, automatically escalate to AI footprint detection or full analysis instead of saving that simplified perimeter as authoritative.

3. Normalize footprint sources and ranking
- Unify source naming across paths (`osm_overpass` vs `osm_buildings`) so the same quality rules apply everywhere.
- Rank candidates by detail + confidence + area sanity, not by “first usable footprint.”
- Keep “best available” behavior, but do not allow a low-detail polygon to win just because it is the only fast result.

4. Stop frontend corrections that hide the real problem
- Remove or tighten the north/south OSM rescaling in `SchematicRoofDiagram`.
- If the saved footprint is low-detail, render it honestly as approximate instead of stretching it and making the mismatch look like a drawing bug.

5. Keep footprint-driven eave/rake generation, but only from vetted geometry
- Continue deriving eaves/rakes from `footprint_vertices_geo`.
- Ensure the saved footprint includes every kickout vertex before those edges are generated.
- Leave hybrid luminance fitting in place only for minor inward/outward refinement.

Files to update:
- `supabase/functions/start-ai-measurement/index.ts`
- `supabase/functions/analyze-roof-aerial/index.ts`
- `supabase/functions/_shared/footprint-resolver.ts` and/or `supabase/functions/footprint-fusion/index.ts`
- `src/components/measurements/SchematicRoofDiagram.tsx`

Validation after implementation:
- Re-run the same property and confirm logs do not save a low-detail 5-vertex OSM footprint when better geometry or AI fallback is needed.
- Confirm `footprint_vertices_geo` contains the kickout vertices.
- Confirm the green eave/rake lines now follow each perimeter corner.
- Confirm low-detail fallback cases show “approximate/manual review” instead of pretending to match.

Technical note:
- The renderer is no longer the main blocker; it already supports multi-point edge drawing.
- The real issue is upstream footprint quality and the async flow bypassing the better resolver path.
