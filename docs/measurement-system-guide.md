# Measurement System User Guide

## Overview
The PITCH CRM measurement system provides professional roof measurements at $0 cost by leveraging Google Solar API and Mapbox satellite imagery.

## Workflow Steps

### 1. Pull Measurements
- Navigate to lead/property
- Click "Pull Measurements" button
- System fetches data from Google Solar API (5-10 seconds)
- Satellite visualization auto-generates

### 2. Verify & Adjust
- Review satellite image with measurement overlays
- Adjust pitch (flat to 12/12) using dropdown
- Adjust waste factor (10%, 12%, 15%, 20%)
- Set number of stories (1-5)
- Use zoom controls to improve framing
- Use pan controls (arrow buttons) to center property

### 3. Accept & Create Estimate
- Click "Accept & Create Estimate" button
- System saves adjusted measurements to database
- Navigates to estimate builder
- Auto-populates 6 material line items

### 4. Save Estimate
- Review auto-populated quantities
- Adjust unit costs if needed
- Click "Calculate" to compute pricing
- Click "Save Estimate" to persist

## Measurement Data Quality

### What Google Solar API Provides:
- ✅ **Accurate:** Total roof area, pitch, direction
- ✅ **Accurate:** Linear features (ridge, hip, valley, eave, rake)
- ✅ **Accurate:** Penetrations (vents, skylights, etc.)
- ⚠️ **Limitation:** Aggregate data - all facets share building outline
- ⚠️ **Limitation:** No individual facet boundary polygons

### Material Calculation Accuracy:
- **Expected:** 95%+ accuracy for shingles, ridge cap, drip edge
- **Expected:** 90%+ accuracy for ice & water shield, valley material
- **Reason:** Google Solar provides aggregate measurements sufficient for material quantities

### When to Use Premium Measurements:
- Complex roofs with 8+ facets
- Multi-level roofs with complex valleys
- Jobs requiring exact facet-by-facet breakdowns
- High-value commercial projects ($50K+)
- Historic or architecturally significant buildings

## Troubleshooting

### Satellite Image Not Loading
1. Check internet connection
2. Click "Regenerate Satellite View" button
3. System will retry with exponential backoff (3 attempts)
4. Automatic fallback to Google Maps if Mapbox unavailable

### Measurements Appear Incorrect
1. Verify property address is correct
2. Adjust pitch if roof appears steeper/flatter than detected
3. Increase waste factor for complex roofs (15-20%)
4. Use Facet Splitter tool to manually divide roof sections

### Auto-Population Not Working
1. Ensure measurements have been pulled and accepted
2. Check that `total_squares > 0` in database
3. Verify URL parameter: `?tab=estimate&autoPopulate=true`
4. Check browser console logs for error messages

### Satellite Image Doesn't Show Building Clearly
1. Use zoom controls (+ / -) to adjust framing
2. Use pan controls (arrow buttons) to center building
3. Click "Regenerate Satellite View" after adjustments
4. Try different zoom levels: -1 (wider), 0 (optimal), +1, +2 (closer)

## Performance Targets
- ⏱️ Measurement Pull: <5 seconds
- ⏱️ Visualization Generation: <10 seconds  
- ⏱️ Auto-Population: <1 second
- 🎯 Success Rate: >95%

## Advanced Features

### Facet Splitter Tool
For roofs with multiple distinct planes:
1. Click "Split Facets" button in verification dialog
2. Draw lines to divide building outline into individual facets
3. System calculates area for each facet
4. Click "Save Split Facets" to persist
5. Visualization regenerates with new facet geometries

### Manual Measurement Editor
For complete custom measurements:
1. Click "Edit Manually" button
2. Draw roof polygon directly on satellite image
3. Add linear features (ridges, hips, valleys)
4. System calculates area and perimeter
5. Save to persist manual measurements

### Annotation System
Add notes and markers to satellite images:
1. Use annotation tools in overlay
2. Add markers for specific roof features
3. Add notes for damage or concerns
4. Add damage indicators for visual reference
5. Annotations persist with measurement

## Integration with Estimates

### Smart Tags in Templates
Measurements automatically populate these smart tags:
- `{{roof.total_sqft}}` → Measured roof area
- `{{roof.squares}}` → Calculated squares
- `{{roof.pitch_factor}}` → Pitch multiplier
- `{{lf.ridge}}` → Ridge length in feet
- `{{lf.hip}}` → Hip length in feet
- `{{lf.valley}}` → Valley length in feet
- `{{waste.10pct.squares}}` → Waste-adjusted squares at 10%
- `{{waste.12pct.squares}}` → Waste-adjusted squares at 12%
- `{{waste.15pct.squares}}` → Waste-adjusted squares at 15%

### Template Expressions
Use calculations in templates:
- `{{ ceil(lf.ridge / 33) }}` → Ridge cap bundles
- `{{ floor((lf.eave + lf.rake) / 100) }}` → Starter bundles
- `{{ roof.squares * 3 }}` → Shingle bundles

### Material Auto-Population
When clicking "Accept & Create Estimate", these line items auto-populate:
1. **Asphalt Shingles:** `roof.squares` quantity
2. **Ridge Cap:** `ceil((ridge + hip) / 3)` bundles
3. **Starter Strip:** `ceil((eave + rake) / 100)` bundles
4. **Ice & Water Shield:** `ceil((valley + eave*0.25) / 65)` rolls
5. **Drip Edge:** `perimeter / 10` pieces
6. **Valley Material:** `valley / 10` pieces

## Best Practices

### Before Pulling Measurements
- Verify property address is accurate
- Confirm coordinates are correct (not 0,0)
- Check that property exists in Google Maps

### During Verification
- Review satellite image for clarity
- Verify pitch matches actual roof slope
- Adjust waste factor based on roof complexity
- Count stories for accurate job complexity

### Before Creating Estimate
- Double-check all measurements
- Verify linear features are reasonable
- Confirm penetration counts
- Review calculated material quantities

### After Saving Estimate
- Review unit costs and update if needed
- Verify profit margin is acceptable
- Check total price against market rates
- Send to customer for approval

## Support & Documentation

For additional help:
- Check inline tooltips (hover over ? icons)
- Review measurement system limitations in verification dialog
- Contact support for complex measurement scenarios
- Request training for advanced features

---

**Version:** 1.0.0  
**Last Updated:** Phase 5 Implementation  
**Author:** PITCH CRM Development Team
