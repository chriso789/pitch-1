
# Fix: Missing Cover Page and Materials Marketing Flyer in Estimate PDFs

## Problem Summary

The generated estimate PDF is missing two expected components:

1. **Cover Page** - Not appearing at the start of the PDF
2. **Materials Marketing Flyer** - Metal roof product flyer not appended to the end

---

## Root Cause Analysis

### Issue 1: Cover Page Not Showing

**Why it's missing:**

The `showCoverPage` option defaults to **`false`** in the PDF presets:

```typescript
// src/components/estimates/PDFComponentOptions.ts (line 103)
showCoverPage: false,  // Both customer and internal presets
```

The user must manually check the **"Include Cover Page"** checkbox in the Estimate Add-ons panel before creating the estimate. This was not checked when the estimate was created.

**Evidence:** The `EstimateAddonsPanel` has the toggle (lines 108-124), and the `EstimateCoverPage` component exists and works - it's just not enabled by default.

---

### Issue 2: Metal Roof Flyer Not Attached

**Why it's missing:**

The estimates were created using templates that **no longer exist** in the database:
- `abc93b46-fad5-40a8-b124-f5eb907451d5` (5V Metal) - **DELETED**
- `f17563f3-65a2-4802-a115-a0d09913b15c` (SnapLok) - **DELETED**

The metal roof flyer attachment is configured for template `9a7ed90d-3774-4ca2-bfba-e9766630c5c0` ("Standard Metal Roof"), which is a **different** template.

**Attachment configuration found:**
| Document | Template Attached To |
|----------|----------------------|
| `obc_-_metal_roof_flyer.pdf` | `9a7ed90d-3774-4ca2-bfba-e9766630c5c0` (Standard Metal Roof) |

**Templates used for Nicole Walker's estimates:**
| Estimate | Template ID | Status |
|----------|-------------|--------|
| OBR-00027-9opp | `abc93b46-...` | **Template deleted** |
| OBR-00025-q8fe | `abc93b46-...` | **Template deleted** |
| OBR-00024-lt6o | `f17563f3-...` | **Template deleted** |

Since those templates were deleted, the `fetchTemplateAttachments` function finds no attachments to merge.

---

## Recommended Fixes

### Fix 1: Enable Cover Page by Default for Customer PDFs

Change the default in `PDFComponentOptions.ts`:

```typescript
// Change from:
showCoverPage: false,

// Change to:
showCoverPage: true,  // Customer preset only
```

This makes the professional cover page standard for all customer-facing estimates.

---

### Fix 2: Attach Flyer to ALL Metal Templates (Roof-Type Based)

Instead of attaching flyers template-by-template, implement a **roof-type-based** attachment system. When creating an estimate with a metal template, automatically attach the metal flyer regardless of which specific metal template is used.

**Option A: Database Fix - Add attachment to all metal templates**

For all metal templates in the tenant, create attachment records:

```sql
-- Add flyer attachment to all metal roof templates for tenant
INSERT INTO estimate_template_attachments (tenant_id, template_id, document_id, attachment_order)
SELECT 
  '14de934e-7964-4afd-940a-620d2ace125d',
  et.id,
  '9c38279e-4eff-47b2-9506-2a34897a8250',
  0
FROM estimate_templates et
WHERE et.tenant_id = '14de934e-7964-4afd-940a-620d2ace125d'
  AND et.roof_type = 'metal'
  AND NOT EXISTS (
    SELECT 1 FROM estimate_template_attachments eta
    WHERE eta.template_id = et.id
  );
```

**Option B: Code Enhancement - Query by roof_type**

Modify `fetchTemplateAttachments` to also check for roof-type-based attachments when template-specific ones aren't found:

```typescript
// If no template-specific attachments, check for roof-type attachments
if (data.length === 0 && selectedTemplate?.roof_type) {
  const { data: roofTypeAttachments } = await supabaseClient
    .from('roof_type_attachments')
    .select('document_id, documents(file_path, filename)')
    .eq('roof_type', selectedTemplate.roof_type);
  // Use these instead
}
```

---

### Fix 3: Recreate Missing Templates (If Needed)

If the original 5V and SnapLok templates were deleted accidentally, they should be recreated and have the flyer attachment linked. Currently there are only 3 templates in the database for this tenant:
- Standard Shingle Roof
- Standard Metal Roof  
- Standard Tile Roof

---

## Immediate Actions

### 1. Change Cover Page Default

**File:** `src/components/estimates/PDFComponentOptions.ts`

Update customer preset:
```typescript
// Line 103
showCoverPage: true,  // Changed from false
```

### 2. Link Flyer to Existing Metal Template

Since the Standard Metal Roof template exists and has the flyer already attached, **no additional database changes needed** if users select that template.

However, if you need the flyer attached when using templates with `roof_type = 'metal'` that don't have explicit attachments, add a fallback query in `fetchTemplateAttachments`.

### 3. Enhance Template Attachment Logic (Optional)

Modify `MultiTemplateSelector.tsx` to fetch attachments based on **roof_type** as a fallback when template-specific attachments aren't found. This ensures any metal template automatically gets the metal flyer.

---

## Files to Modify

| File | Change |
|------|--------|
| `src/components/estimates/PDFComponentOptions.ts` | Enable `showCoverPage: true` in customer preset |
| `src/components/estimates/MultiTemplateSelector.tsx` | Add fallback to roof-type-based attachments |

---

## Testing After Fix

1. Create a new estimate using any metal template
2. Verify the Cover Page appears as the first page
3. Verify the Metal Roof Flyer is appended as the last page
4. Test with shingle template to confirm flyer is NOT appended (only for metal)
