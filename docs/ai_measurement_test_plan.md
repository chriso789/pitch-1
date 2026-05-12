# AI Measurement System Test Plan

## Overview

This document outlines the testing strategy for the AI Measurement System, focusing on the quality controls, geometry validation, and failure modes implemented in the system overhaul.

## Test Categories

### 1. Footprint Source Tests

| Test ID | Description | Expected Behavior |
|---------|-------------|-------------------|
| FP-001 | Request measurement with valid Mapbox Vector footprint | Returns measurement with `footprintSource: 'mapbox_vector'` |
| FP-002 | Request measurement with Microsoft Buildings fallback | Returns measurement with `footprintSource: 'microsoft_buildings'` |
| FP-003 | Request measurement with OSM fallback | Returns measurement with `footprintSource: 'osm'` |
| FP-004 | Request measurement with no available footprint | Returns error `NO_FOOTPRINT_AVAILABLE`, does NOT create fake measurement |
| FP-005 | Request measurement with user-traced footprint | Returns measurement with `footprintSource: 'user_traced'` |
| FP-006 | Request measurement with vendor report | Returns measurement with `footprintSource: 'vendor_report'` |

**Test Addresses:**
- `4205 Custer Drive, Valrico, FL` - Known good Mapbox footprint
- `123 Remote Mountain Rd, Rural, MT` - Known no footprint (should fail gracefully)
- Custom trace test - Use manual drawing interface

### 2. Pitch Source Tests

| Test ID | Description | Expected Behavior |
|---------|-------------|-------------------|
| PS-001 | Measurement with DSM pitch detection | Returns `pitchSource: 'dsm'`, `isReliable: true` |
| PS-002 | Measurement with Solar API pitch | Returns `pitchSource: 'solar_api'`, `isReliable: true` |
| PS-003 | Measurement with assumed pitch (no data) | Returns `pitchSource: 'assumed'`, `isReliable: false`, warnings include pitch notice |
| PS-004 | Vendor report with explicit pitch | Returns `pitchSource: 'vendor'`, `isReliable: true` |
| PS-005 | User-input pitch override | Returns `pitchSource: 'user_input'`, `isReliable: true` |

### 3. Geometry Validation Gate Tests

| Test ID | Description | Expected Behavior |
|---------|-------------|-------------------|
| GV-001 | Valid footprint with 4+ vertices | Passes validation, `geometryValidation.isValid: true` |
| GV-002 | Invalid footprint with 2 vertices | Fails validation, measurement NOT saved |
| GV-003 | Area within valid range (100-100,000 sqft) | Passes validation |
| GV-004 | Area below minimum (50 sqft) | Fails validation with `AREA_TOO_SMALL` error |
| GV-005 | Area above maximum (150,000 sqft) | Fails validation with `AREA_TOO_LARGE` error |
| GV-006 | Area ratio check (flat vs adjusted) | Fails if ratio > 2.5 |
| GV-007 | Linear features reasonability | Fails if ridge > 1.5x perimeter |
| GV-008 | Perimeter reasonability | Fails if perimeter < 20ft or > 5000ft |

### 4. Quality Indicator Tests

| Test ID | Description | Expected Behavior |
|---------|-------------|-------------------|
| QI-001 | High confidence measurement (90%+) | `isReliable: true`, no major warnings |
| QI-002 | Low confidence measurement (<50%) | `isReliable: false`, `requiresManualReview: true` |
| QI-003 | Measurement with assumed pitch | Warning added: "Pitch assumed at 4/12" |
| QI-004 | Measurement with bbox fallback | Warning added about rectangular approximation |
| QI-005 | Measurement with multiple fallbacks | All fallbacks listed in `usedFallbacks` array |

### 5. Multi-Page Vendor Report Tests

| Test ID | Description | Expected Behavior |
|---------|-------------|-------------------|
| VR-001 | Single page Roofr report | Extracts area, pitch, and available linear features |
| VR-002 | Multi-page EagleView report (10+ pages) | Extracts data from all relevant pages |
| VR-003 | Report with measurements on page 2-3 | Correctly parses measurements from later pages |
| VR-004 | Report with linear features section | Extracts ridge, hip, valley, eave, rake |
| VR-005 | Report with facet details table | Extracts individual facet data |
| VR-006 | Xactimate report format | Parses Xactimate-specific format |
| VR-007 | Report with geometry (WKT) | Extracts polygon geometry when available |

**Test Files:**
- `tests/fixtures/roofr_single_page.pdf`
- `tests/fixtures/eagleview_multipage.pdf`
- `tests/fixtures/xactimate_report.pdf`

### 6. Aerial Overlay Alignment Tests

| Test ID | Description | Expected Behavior |
|---------|-------------|-------------------|
| AO-001 | Overlay at zoom 20 | Linear features align with satellite imagery |
| AO-002 | Coordinate precision | GPS coordinates stored with 8+ decimal places |
| AO-003 | Center alignment | Polygon centroid aligns with building center |
| AO-004 | Edge alignment | Eaves align with visible roof edges |
| AO-005 | Manual offset adjustment | Offset can be applied via `alignmentOffset` prop |

**Visual Inspection Required:**
- Compare overlay against satellite imagery
- Check ridge lines follow actual roof ridges
- Verify perimeter matches building footprint

### 7. Debug Panel Tests

| Test ID | Description | Expected Behavior |
|---------|-------------|-------------------|
| DP-001 | Debug panel renders | Panel visible with "Debug Info" header |
| DP-002 | Quality indicators shown | Confidence, footprintSource, pitchSource displayed |
| DP-003 | Warnings displayed | All warnings from measurement shown |
| DP-004 | Analysis params shown | lat, lng, zoom, imageSize displayed |
| DP-005 | Collapsed by default | Panel starts collapsed, expands on click |

### 8. PDF Report Quality Tests

| Test ID | Description | Expected Behavior |
|---------|-------------|-------------------|
| PR-001 | Report with reliable measurement | Standard disclaimer shown |
| PR-002 | Report with unreliable measurement | Strong warning box shown on page 1 |
| PR-003 | Report with assumed pitch | Warning about assumed pitch visible |
| PR-004 | Data sources displayed | Footprint and pitch sources shown |
| PR-005 | Quality warnings in report | Quality warnings listed in report |

### 9. Database Schema Tests

| Test ID | Description | Expected Behavior |
|---------|-------------|-------------------|
| DB-001 | New columns exist | `footprint_source`, `pitch_source`, `fallback_flags`, etc. |
| DB-002 | QA results table | `measurement_qa_results` table created |
| DB-003 | Debug artifacts table | `measurement_debug_artifacts` table created |
| DB-004 | Footprint candidates table | `measurement_footprint_candidates` table created |
| DB-005 | RLS policies work | Users can only access their own measurement data |

### 10. Error Handling Tests

| Test ID | Description | Expected Behavior |
|---------|-------------|-------------------|
| EH-001 | No footprint available | Returns clear error message, NOT fake data |
| EH-002 | Geometry validation fails | Returns validation errors, measurement NOT saved |
| EH-003 | API timeout | Graceful timeout with retry suggestion |
| EH-004 | Invalid address | Clear error message about address |
| EH-005 | Rate limiting | Appropriate backoff and retry |

---

## Integration Test Scenarios

### Scenario 1: Complete Happy Path
1. Enter valid address with good Mapbox coverage
2. System fetches footprint from Mapbox Vector
3. Solar API provides pitch data
4. Geometry validation passes
5. Measurement saved with high confidence
6. Report generated without warnings

### Scenario 2: Fallback Path
1. Enter address with no Mapbox coverage
2. System falls back to Microsoft Buildings
3. No Solar API pitch available (assumed 4/12)
4. Geometry validation passes but flags pitch as assumed
5. Measurement saved with `isReliable: false`
6. Report shows warning about assumed pitch

### Scenario 3: Failure Path
1. Enter remote address with no footprint data
2. All footprint sources fail
3. System returns error `NO_FOOTPRINT_AVAILABLE`
4. No fake measurement created
5. UI displays clear error message
6. Suggestion to upload vendor report or draw manually

### Scenario 4: Vendor Report Path
1. Upload EagleView PDF report
2. Multi-page parser extracts all measurements
3. Linear features parsed from measurements page
4. `pitchSource: 'vendor'`, high confidence
5. Geometry validation uses vendor polygon
6. Report shows "Vendor Report" as data source

---

## Performance Benchmarks

| Metric | Target | Acceptable |
|--------|--------|------------|
| Footprint fetch (Mapbox) | < 500ms | < 1000ms |
| Geometry validation | < 50ms | < 100ms |
| Full measurement pipeline | < 5s | < 10s |
| PDF report generation | < 3s | < 5s |
| Vendor report parsing | < 2s | < 4s |

---

## Test Data Requirements

### Addresses by Footprint Source
- **Mapbox Vector:** `4205 Custer Drive, Valrico, FL 33596`
- **Microsoft Buildings:** `1234 Suburban Lane, Anytown, USA`
- **OSM:** European addresses often have OSM data
- **No Data:** Remote rural addresses

### Sample Vendor Reports
- Roofr single-page report
- EagleView multi-page report (10+ pages)
- Xactimate estimate
- HoverMap report

### Edge Cases
- Very small buildings (< 500 sqft)
- Very large commercial buildings
- Complex multi-facet roofs
- Flat commercial roofs
- High-pitch steep roofs (12/12)

---

## Regression Checklist

Before deployment, verify:

- [ ] No rectangular bbox fallbacks created
- [ ] Assumed pitch always marked as unreliable
- [ ] Geometry validation gate blocks invalid measurements
- [ ] Multi-page vendor reports parsed completely
- [ ] Debug panel shows quality indicators
- [ ] PDF reports include quality warnings
- [ ] Database migration applied successfully
- [ ] All existing tests pass
- [ ] No TypeScript errors

---

## Manual QA Checklist

### Visual Inspection
- [ ] Aerial overlay aligns with satellite imagery
- [ ] Linear features (ridge, hip, valley) follow actual roof lines
- [ ] Facet polygons cover roof surfaces correctly
- [ ] Colors and labels are legible

### UI/UX
- [ ] Debug panel expandable/collapsible
- [ ] Warning badges visible for low-confidence measurements
- [ ] Error messages are user-friendly
- [ ] Loading states display properly

### Reports
- [ ] PDF opens without errors
- [ ] All pages render correctly
- [ ] Quality warnings prominent when applicable
- [ ] Measurements match database values

---

*Document generated: May 12, 2026*
*Version: 1.0*
