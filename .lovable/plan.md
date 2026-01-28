
# Plan: Save Estimate Name and Quality Tier to Documents

## Problem

When estimate PDFs are saved to the documents list, they only show the generic filename (e.g., "OBR-00023-8818.pdf") with an "Estimates" badge. The custom estimate name and pricing tier (Good/Better/Best) that users enter are not being passed to the document record or displayed.

---

## Solution Overview

| What | How |
|------|-----|
| **Store estimate metadata** | Add `estimate_display_name` and `estimate_pricing_tier` columns to `documents` table |
| **Pass data when saving** | Update `saveEstimatePdf` function to accept and store these fields |
| **Display in documents list** | Update `DocumentsTab` to show estimate name as title and tier badge for estimate documents |

---

## Database Schema Change

Add two new nullable columns to the `documents` table:

```sql
ALTER TABLE documents
ADD COLUMN estimate_display_name TEXT,
ADD COLUMN estimate_pricing_tier TEXT CHECK (estimate_pricing_tier IN ('good', 'better', 'best'));
```

---

## Files to Modify

| File | Change |
|------|--------|
| `src/lib/estimates/estimatePdfSaver.ts` | Add `estimateDisplayName` and `estimatePricingTier` parameters; include them in the document insert |
| `src/components/estimates/MultiTemplateSelector.tsx` | Pass `estimateDisplayName` and `estimatePricingTier` when calling `saveEstimatePdf` |
| `src/components/DocumentsTab.tsx` | Update Document interface and UI to display estimate name/tier for estimate documents |

---

## Technical Implementation

### 1. Update `estimatePdfSaver.ts`

Add new parameters and include them in the database insert:

```typescript
export async function saveEstimatePdf({
  pdfBlob,
  pipelineEntryId,
  tenantId,
  estimateNumber,
  description,
  userId,
  estimateDisplayName,  // NEW
  estimatePricingTier,  // NEW
}: {
  pdfBlob: Blob;
  pipelineEntryId: string;
  tenantId: string;
  estimateNumber: string;
  description: string;
  userId: string;
  estimateDisplayName?: string | null;  // NEW
  estimatePricingTier?: string | null;  // NEW
}): Promise<EstimatePdfSaveResult> {
  // ... upload logic unchanged ...
  
  // Document record insert includes new fields:
  .insert({
    tenant_id: tenantId,
    pipeline_entry_id: pipelineEntryId,
    document_type: 'estimate',
    filename: `${estimateNumber}.pdf`,
    file_path: pdfPath,
    file_size: pdfBlob.size,
    mime_type: 'application/pdf',
    description,
    uploaded_by: userId,
    estimate_display_name: estimateDisplayName || null,    // NEW
    estimate_pricing_tier: estimatePricingTier || null,    // NEW
  })
}
```

### 2. Update `MultiTemplateSelector.tsx` (line ~936)

Pass the estimate name and tier when calling `saveEstimatePdf`:

```typescript
const result = await saveEstimatePdf({
  pdfBlob,
  pipelineEntryId,
  tenantId,
  estimateNumber,
  description: shortDescription,
  userId: user.id,
  estimateDisplayName: estimateDisplayName.trim() || null,  // NEW
  estimatePricingTier: estimatePricingTier || null,         // NEW
});
```

### 3. Update `DocumentsTab.tsx`

**A. Update Document interface (line ~35):**

```typescript
interface Document {
  // ... existing fields ...
  estimate_display_name?: string | null;    // NEW
  estimate_pricing_tier?: string | null;    // NEW
}
```

**B. Update document row display (line ~1073):**

For estimate documents, show:
- Primary title: estimate display name (if set), otherwise filename
- Tier badge with color coding (Good=gray, Better=blue, Best=amber)

```tsx
<div className="flex-1 min-w-0">
  {/* Show estimate display name as primary title for estimate documents */}
  <p className="font-medium truncate">
    {doc.document_type === 'estimate' && doc.estimate_display_name 
      ? doc.estimate_display_name 
      : doc.filename}
  </p>
  <div className="flex items-center gap-3 text-sm text-muted-foreground">
    <Badge variant="outline">{category?.label || 'Other'}</Badge>
    
    {/* Pricing tier badge for estimates */}
    {doc.document_type === 'estimate' && doc.estimate_pricing_tier && (
      <Badge 
        variant="outline" 
        className={cn(
          doc.estimate_pricing_tier === 'best' && 'border-amber-500 text-amber-600 bg-amber-50',
          doc.estimate_pricing_tier === 'better' && 'border-blue-500 text-blue-600 bg-blue-50',
          doc.estimate_pricing_tier === 'good' && 'border-gray-400 text-gray-600 bg-gray-50'
        )}
      >
        {doc.estimate_pricing_tier.toUpperCase()}
      </Badge>
    )}
    
    <span>{formatFileSize(doc.file_size)}</span>
    {/* ... rest of metadata ... */}
  </div>
  {/* Show filename as subtitle if we're showing display name */}
  {doc.document_type === 'estimate' && doc.estimate_display_name && (
    <p className="text-xs text-muted-foreground mt-0.5">{doc.filename}</p>
  )}
</div>
```

---

## Visual Result

**Before:**
```
📄 OBR-00023-8818.pdf
   [Estimates]  607.1 KB  less than a minute ago  by Chris O'Brien
```

**After:**
```
📄 Premium Shingle Upgrade Quote
   [Estimates]  [BEST]  607.1 KB  less than a minute ago  by Chris O'Brien
   OBR-00023-8818.pdf
```

---

## Summary

| Change | Purpose |
|--------|---------|
| DB: Add `estimate_display_name` and `estimate_pricing_tier` columns | Store the metadata |
| `estimatePdfSaver.ts`: Accept new params | Pass data to document record |
| `MultiTemplateSelector.tsx`: Pass values | Connect estimate builder to saver |
| `DocumentsTab.tsx`: Display name + tier badge | Show metadata in documents list |

This ensures that when users give an estimate a custom name and select a quality tier, that information flows through to the documents list for easy identification.
