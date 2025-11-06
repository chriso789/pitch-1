# Smart Tags Documentation

## Overview
Smart Tags are dynamic placeholders that auto-populate with measurement data in estimate templates. The system now includes **100+ tags** covering roof measurements, materials, and calculations.

## Usage in Templates
```
Total Roof Area: {{roof.total_sqft}} sq ft
Squares: {{roof.squares}}
Shingle Bundles (10% waste): {{bundles.shingles.waste_10pct}}
Ridge Cap: {{bundles.ridge_cap}} bundles
Labor Hours: {{calc.labor_hours}} hours
```

## Mathematical Expressions
```
{{ceil(lf.ridge / 33)}}           // Ridge cap bundles
{{roof.squares * 3}}              // Shingle bundles
{{waste.10pct.sqft / 100}}        // Squares with waste
```

## Categories

### Basic Measurements
- `roof.total_sqft` - Total pitch-adjusted area
- `roof.squares` - Total squares (area / 100)
- `roof.faces_count` - Number of roof planes
- `roof.complexity` - Complexity score (1-5)

### Individual Facets (1-20)
- `facet.1.area_sqft` - Facet 1 area
- `facet.1.pitch` - Facet 1 pitch (e.g., "6/12")
- `facet.1.direction` - Compass direction (N, NE, E, etc.)
- `facet.1.squares` - Facet 1 in squares

### Pitch Breakdown
- `pitch.4_12.sqft` - Area at 4/12 pitch
- `pitch.6_12.sqft` - Area at 6/12 pitch
- `pitch.flat.sqft` - Flat roof area

### Waste-Adjusted (0%, 8%, 10%, 12%, 15%, 17%, 20%)
- `waste.10pct.sqft` - Area with 10% waste
- `waste.10pct.squares` - Squares with 10% waste

### Linear Features
- `lf.ridge`, `lf.hip`, `lf.valley`, `lf.eave`, `lf.rake`
- `lf.ridge_hip_total` - Combined ridge + hip

### Materials (Base)
- `bundles.shingles` - Shingle bundles (3 per square)
- `bundles.ridge_cap` - Ridge cap bundles
- `rolls.underlayment` - Underlayment rolls
- `sticks.drip_edge` - Drip edge sticks

### Materials (Waste-Adjusted)
- `bundles.shingles.waste_10pct`
- `rolls.underlayment.waste_15pct`
- `sticks.drip_edge.waste_10pct`

### Calculations
- `calc.labor_hours` - Estimated labor hours
- `calc.crew_days` - Crew days (4-person crew)
- `calc.dump_runs` - Dump runs needed

See `src/lib/measurements/smartTagRegistry.ts` for complete tag definitions.
