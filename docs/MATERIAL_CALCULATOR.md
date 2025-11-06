# Material Calculation Engine

## Overview

The Material Calculation Engine automatically calculates roofing material quantities based on roof measurements, with support for:
- **Brand-specific products** from SRS supplier catalog
- **Waste factor adjustments** (0%, 8%, 10%, 12%, 15%, 17%, 20%)
- **Automatic quantity calculations** for all roofing materials
- **Real-time pricing** from SRS pricelist
- **Material order generation** (integration ready)

## Features

### 1. Automated Material Calculations

The engine calculates quantities for:
- **Shingles**: Based on total squares (3 bundles per square)
- **Ridge & Hip Cap**: Based on linear feet (33 LF per bundle)
- **Starter Strip**: Based on eave + rake length (varies by brand)
- **Underlayment**: Based on total squares (10 squares per roll)
- **Ice & Water Shield**: Based on eaves + valleys (2 squares per roll)
- **Valley Material**: Based on valley length (50 LF per roll)
- **Drip Edge**: Based on perimeter (10 LF per stick)
- **Penetration Flashings**: Based on penetration counts

### 2. Brand Selection

Choose preferred brands for each material category:
- **Shingles**: GAF, Owens Corning, CertainTeed, IKO, Atlas, TAMKO
- **Underlayment**: Top Shield, GAF, CertainTeed, Owens Corning, Atlas, CMI
- **Ridge Cap**: GAF, Owens Corning, CertainTeed, IKO, Atlas, TAMKO
- **Ice & Water**: GAF, CertainTeed, Atlas, Owens Corning, Polyglass, CMI
- **Starter**: GAF, Owens Corning, CertainTeed, IKO, Atlas, TAMKO, Top Shield

### 3. Waste Factor Management

Standard waste percentages:
- **0%**: Exact quantities (no waste)
- **8%**: Minimal waste (simple roofs)
- **10%**: Standard waste (most common)
- **12%**: Moderate waste (typical complexity)
- **15%**: High waste (complex roofs)
- **17%**: Very high waste (very complex)
- **20%**: Maximum waste (extreme complexity)

Waste is applied to area-based materials (shingles, underlayment, etc.) but not to counted items (penetration flashings).

## Usage

### Frontend Component

```typescript
import { MaterialCalculator } from '@/components/materials/MaterialCalculator';
import type { RoofMeasurementData } from '@/lib/measurements/materialCalculations';

const measurementData: RoofMeasurementData = {
  total_area_sqft: 2500,
  total_squares: 25,
  lf_ridge: 48,
  lf_hip: 72,
  lf_valley: 35,
  lf_eave: 125,
  lf_rake: 85,
  lf_step: 28,
  penetration_counts: {
    pipe_vent: 6,
    skylight: 2,
    chimney: 1,
  },
};

<MaterialCalculator
  measurementData={measurementData}
  pipelineEntryId="pipeline-entry-id"
  onOrderCreated={(orderId) => console.log('Order created:', orderId)}
/>
```

### Programmatic Calculation

```typescript
import { calculateMaterials } from '@/lib/measurements/materialCalculations';

const result = calculateMaterials(measurementData, {
  waste_percentage: 10,
  selected_brands: {
    shingles: 'GAF',
    underlayment: 'Top Shield',
    ridge_cap: 'GAF',
    ice_water: 'GAF',
    starter: 'GAF',
  },
});

console.log('Total cost:', result.total_waste_adjusted_cost);
console.log('Shingle bundles:', result.summary.shingle_bundles);
console.log('Materials:', result.waste_adjusted_materials);
```

### Edge Function API

```typescript
// Call edge function
const { data, error } = await supabase.functions.invoke('calculate-materials', {
  body: {
    measurement_id: 'measurement-uuid',
    waste_percentage: 10,
    selected_brands: {
      shingles: 'GAF',
      underlayment: 'Top Shield',
    },
  },
});

// Or with pipeline entry ID
const { data, error } = await supabase.functions.invoke('calculate-materials', {
  body: {
    pipeline_entry_id: 'pipeline-entry-uuid',
    waste_percentage: 12,
  },
});

// Or with direct measurement data
const { data, error } = await supabase.functions.invoke('calculate-materials', {
  body: {
    measurement_data: {
      total_area_sqft: 2500,
      total_squares: 25,
      lf_ridge: 48,
      lf_hip: 72,
      // ...
    },
    waste_percentage: 10,
  },
});
```

## Material Calculation Logic

### Shingles
```
Squares = Total Area (sq ft) / 100
Bundles = Squares × 3 (bundles per square)
With Waste = ceil(Bundles × (1 + waste_percentage/100))
```

### Ridge & Hip Cap
```
Total LF = Ridge LF + Hip LF
Bundles = ceil(Total LF / 33) // 33 LF per bundle
With Waste = ceil(Bundles × (1 + waste_percentage/100))
```

### Starter Strip
```
Total LF = Eave LF + Rake LF
Bundles = ceil(Total LF / LF_per_bundle) // varies by brand
With Waste = ceil(Bundles × (1 + waste_percentage/100))
```

### Underlayment
```
Rolls = ceil(Squares / 10) // 10 squares per roll
With Waste = ceil(Rolls × (1 + waste_percentage/100))
```

### Ice & Water Shield
```
Eave Area = (Eave LF × 3 feet) / 100 // 3 feet from edge
Valley Area = (Valley LF × 3 feet) / 100 // 3 feet wide
Total Squares = Eave Area + Valley Area
Rolls = ceil(Total Squares / 2) // 2 squares per roll
With Waste = ceil(Rolls × (1 + waste_percentage/100))
```

### Valley Material
```
Rolls = ceil(Valley LF / 50) // 50 LF per roll
With Waste = ceil(Rolls × (1 + waste_percentage/100))
```

### Drip Edge
```
Total LF = Eave LF + Rake LF
Sticks = ceil(Total LF / 10) // 10 LF per stick
With Waste = ceil(Sticks × (1 + waste_percentage/100))
```

### Penetration Flashings
```
Pipe Boots = Pipe Vent Count × 1
Skylight Kits = Skylight Count × 1
Chimney Kits = Chimney Count × 1
// No waste applied to counted items
```

## Material Order Generation

### Auto-Generate Order (Coming Soon)

The material calculator integrates with the material order system:

```typescript
const handleCreateOrder = async () => {
  const orderId = await createOrderFromEstimate(estimateId, vendorId, {
    deliveryAddress: projectAddress,
    branchCode: 'SRS-001',
    notes: 'Generated from material calculator',
  });
  
  console.log('Order created:', orderId);
};
```

### Order Item Structure

Each calculated material becomes an order item:
```typescript
{
  product_id: 'uuid',
  product_name: 'GAF Timberline HDZ',
  item_code: 'GAF-HDZ',
  quantity: 27,
  unit_of_measure: 'SQ',
  unit_cost: 121.00,
  total_cost: 3267.00,
}
```

## Integration Points

### With Measurement System
- Automatically pulls latest measurement data
- Supports both `measurement_id` and `pipeline_entry_id`
- Real-time updates when measurements change

### With Smart Tags System
- Material quantities available as smart tags
- Example: `{{bundles.shingles.waste_10pct}}` → "75"
- Auto-populates in estimate templates

### With Material Orders
- One-click order creation from calculations
- Pre-filled with calculated quantities and pricing
- Direct integration with vendor systems (SRS)

## Page Route

Navigate to material calculations:
```
/material-calculations/:pipelineEntryId
```

Example:
```
/material-calculations/550e8400-e29b-41d4-a716-446655440000
```

## Troubleshooting

### No Materials Calculated
- **Issue**: Empty material list
- **Solution**: Verify measurement data has non-zero values for area and linear measurements

### Incorrect Quantities
- **Issue**: Quantities seem too high or low
- **Solution**: Check waste percentage setting and ensure measurement units are correct (sq ft, not sq meters)

### Brand Not Found
- **Issue**: Selected brand doesn't appear
- **Solution**: Brand may not be in SRS catalog for that category. System will fall back to first available brand.

### Pricing Outdated
- **Issue**: Prices don't match current pricing
- **Solution**: Update `src/data/srs-pricelist-data.ts` with latest pricing from SRS

## Future Enhancements

1. **Multi-Vendor Support**: Support for ABC Supply, Ferguson, etc.
2. **Real-Time Pricing**: API integration for live pricing updates
3. **Material Comparison**: Side-by-side brand comparison
4. **Custom Products**: Support for custom/specialty products
5. **Delivery Scheduling**: Integrate with vendor delivery systems
6. **Inventory Management**: Track available stock at branches
7. **Historical Pricing**: Price trend analysis over time
8. **Bulk Discounts**: Automatic discount calculations
