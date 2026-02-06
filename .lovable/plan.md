
# Fix: Estimate Short Description Shows Wrong Roof Type

## Problem Identified

The "Saved Estimates" display is showing **"Shingle Premium"** for metal roofing estimates. This happens because the short description generation logic takes the **first word** of the template name:

```javascript
const brandWord = templateName.split(' ')[0]; // Returns "Shingle" for "Shingle to 5v Painted"
const priceWord = breakdown.sellingPrice > 20000 ? 'Premium' : 'Standard' : 'Basic';
const shortDescription = `${brandWord} ${priceWord}`; // = "Shingle Premium" ❌
```

For templates like "Shingle to 5v Painted" or "Shingle to 1" SnapLok Painted", the first word is "Shingle" even though these are **metal roofing** templates.

---

## Solution

Update the short description generation logic to use the template's `roof_type` field (which is correctly set to "metal" for these templates) combined with a smarter brand/style extraction.

### Improved Logic

```javascript
// 1. Get roof type from template (shingle, metal, tile, flat, etc.)
const roofType = selectedTemplate?.roof_type || 'shingle';

// 2. Extract actual material/brand name intelligently
const getDescriptor = (name: string, roofType: string) => {
  // For metal templates, extract the metal type (5v, SnapLok, Standing Seam)
  if (roofType === 'metal') {
    if (name.toLowerCase().includes('5v')) return '5V Metal';
    if (name.toLowerCase().includes('snap')) return 'SnapLok';
    if (name.toLowerCase().includes('standing')) return 'Standing Seam';
    return 'Metal';
  }
  // For shingle templates, extract brand (GAF, Owens Corning, etc.)
  if (roofType === 'shingle') {
    if (name.toLowerCase().includes('gaf')) return 'GAF';
    if (name.toLowerCase().includes('owens')) return 'Owens Corning';
    if (name.toLowerCase().includes('certainteed')) return 'CertainTeed';
    return 'Shingle';
  }
  // Default: capitalize roof type
  return roofType.charAt(0).toUpperCase() + roofType.slice(1);
};

const descriptor = getDescriptor(templateName, roofType);
const priceWord = breakdown.sellingPrice > 20000 ? 'Premium' : 
                  breakdown.sellingPrice > 10000 ? 'Standard' : 'Basic';
const shortDescription = `${descriptor} ${priceWord}`;
```

### Expected Results

| Template Name | Current | Fixed |
|--------------|---------|-------|
| Shingle to 5v Painted | Shingle Premium | 5V Metal Premium |
| Shingle to 1" SnapLok Painted | Shingle Premium | SnapLok Premium |
| GAF Timberline HDZ | GAF Premium | GAF Premium |

---

## Files to Modify

### 1. `src/components/estimates/MultiTemplateSelector.tsx`
- Update lines 901-906 with improved short description generation
- Use template `roof_type` field instead of just the first word
- Add helper function for intelligent descriptor extraction

---

## Technical Details

### Data Available
The template object already includes `roof_type`:
```
{ id: 'abc93b46...', name: 'Shingle to 5v Painted', roof_type: 'metal' }
```

### Existing Data Fix
The two existing estimates can be updated:
```sql
UPDATE enhanced_estimates 
SET short_description = '5V Metal Premium' 
WHERE id = '0c38ca37-cb89-413a-a659-3f7d4cfc8f09';

UPDATE enhanced_estimates 
SET short_description = 'SnapLok Premium' 
WHERE id = 'f1571ce2-dba8-4db9-8a9e-130c104d06a0';
```

---

## Testing

1. Create a new estimate using a metal template
2. Verify the "Saved Estimates" list shows correct descriptor (e.g., "5V Metal Premium")
3. Create a shingle estimate and verify it still shows correctly (e.g., "GAF Premium")
