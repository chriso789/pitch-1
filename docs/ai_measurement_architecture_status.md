# AI Measurement Architecture Status Report

## Investigation Summary

Date: May 12, 2026  
Branch: `claude/active-ai-measurement-validation-debug-twJjM`

### Active Production Code Path

The active AI Measurement pipeline uses:

1. **Frontend Hook**: `src/hooks/useMeasurementJob.ts`
   - Invokes `start-ai-measurement` edge function (line 129)
   - Polls `measurement_jobs` table for status updates

2. **Backend**: `supabase/functions/start-ai-measurement/index.ts` (~6,600 lines)
   - Implements "geometry_first_v2" pipeline
   - Uses autonomous graph solver, topology engine, DSM analyzer
   - Already has sophisticated footprint validation and debug tracking

### Existing Quality Controls (Already on Main)

The production code **already implements** the quality controls that were requested:

| Feature | Status | Location |
|---------|--------|----------|
| `footprint_source` tracking | ✅ Implemented | Column exists, tracked in geometry_report_json |
| `hard_fail_reason` | ✅ Implemented | Stored when measurement fails validation |
| `validation_status` | ✅ Implemented | Tracks pass/fail/needs_review |
| `measurement_confidence` | ✅ Implemented | Confidence scoring exists |
| Geometry validation gate | ✅ Implemented | Multiple validation checks at lines 1315-1470 |
| Debug overlay | ✅ Implemented | `DSMDebugOverlay` component wired to UI |
| Solar bbox rejection | ✅ Implemented | Solar bbox marked as `solar_inner_geometry_not_roof_perimeter` |

### Footprint Source Cascade (from `start-ai-measurement`)

The system tries these sources in order:
1. `osm_overpass` - OpenStreetMap building polygons
2. `google_solar_mask_contour` - Solar API mask extraction
3. `unet_mask` - U-Net neural network detection
4. `ai_detection` - Vision model detection
5. `mapbox_vector` - Mapbox building tiles

### Solar 403 Failure Analysis

The user's error occurred because:
1. **Solar API returned 403** - Google Cloud billing not enabled for project 252046246086
2. **OSM returned 0 candidates** - No building data at that location
3. **Result**: Correct `source_acquisition_failed` hard fail

**This is expected behavior** - the system correctly refuses to create fake geometry when no data sources are available.

The fallback chain in `start-ai-measurement` (lines 1374-1378):
```typescript
const noOSMCandidates = candidates.filter(c => c.source.startsWith("osm_overpass")).length === 0;
const noMaskEvidence = !dsmMask && !unetMask;
const noSolarEvidence = !solarBboxPx && solarSegments.length === 0;
const sourceAcquisitionFailed = noOSMCandidates && noMaskEvidence && noSolarEvidence && footprint.length < 4;
```

**Root cause**: Infrastructure issue (Solar API billing), not a code bug.

### Debug Panel Status

`DSMDebugOverlay` component already exists and is wired into `UnifiedMeasurementPanel.tsx` (line 1497):
- Shows `footprint_source`, `hard_fail_reason`, `validation_status`
- Displays rejected edges, accepted edges, coverage metrics
- Renders overlay on satellite imagery

### What Was Discarded

The stale branch (`claude/fix-roof-tracing-twJjM`) modified the **wrong code path**:
- `supabase/functions/measure/` - Not used in production
- `supabase/functions/analyze-roof-aerial/` - Not used in production
- `src/components/roof-measurement/RoofMeasurementTool.tsx` - Legacy component

All code changes from that branch have been abandoned.

### Remaining Tasks

1. **Fix Solar API 403** (infrastructure, not code):
   
   **If billing is already enabled**, the 403 is likely caused by:
   
   a) **Solar API not enabled** - Go to Google Cloud Console → APIs & Services → Enable "Solar API" (it's separate from Maps APIs)
   
   b) **API key restrictions** - Check if `GOOGLE_SOLAR_API_KEY` has:
      - HTTP referrer restrictions (edge functions don't send referrers)
      - IP restrictions (Supabase edge functions have dynamic IPs)
      - API restrictions that exclude Solar API
   
   c) **Wrong API key** - Verify the key in Supabase edge function secrets matches the project with Solar API enabled
   
   **Debug command**:
   ```bash
   curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/debug-dsm-fetch \
     -H "Authorization: Bearer YOUR_ANON_KEY" \
     -H "Content-Type: application/json" \
     -d '{"lat": 27.9506, "lng": -82.4572}'
   ```
   
   Check `building_insights_status` and `data_layers_status` in the response.

2. **Optional OSM Enhancement**:
   - The OSM query may need expansion for rural areas
   - Consider increasing search radius for buildings

3. **Vendor Report Path**:
   - Multi-page PDF parsing exists in `roof-report-ingest`
   - This provides a manual override when automated sources fail

### Conclusion

The AI Measurement system on `main` already has:
- ✅ Quality source tracking
- ✅ Geometry validation gates
- ✅ Debug panel with overlay
- ✅ Proper hard-fail behavior (no fake geometry)
- ✅ Solar bbox rejection

The user's issue was an infrastructure problem (Solar API 403 + no OSM coverage), not a code bug. The system correctly refused to generate a fake measurement.

---
*Generated by investigation of active production code path*
