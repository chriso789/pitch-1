
# Auto-Attach OBC Metal Roof Flyer to Standing Seam/5V Metal Estimates

## Objective
Automatically attach the **"obc_-_metal_roof_flyer.pdf"** document (the Metal Roofing showcase PDF you showed) to estimates when a **Standing Seam** or **5V Metal** template is selected. The attachment should be appended to the estimate PDF during generation.

---

## Current State

### Database Resources Identified
| Resource | ID | Details |
|----------|-----|---------|
| Metal Roof Flyer Document | `9c38279e-4eff-47b2-9506-2a34897a8250` | `obc_-_metal_roof_flyer.pdf` in company-docs |
| Template Attachments Table | Created | `estimate_template_attachments` junction table exists but is empty |
| Metal Templates | Multiple | Templates with `roof_type: 'metal'` including "Standard Metal Roof", "5V Painted Metal with Polyglass XFR" |

### PDF Generation Flow
1. User selects template in `MultiTemplateSelector.tsx`
2. Template items loaded, pricing calculated
3. `EstimatePDFDocument.tsx` renders the estimate pages
4. `useMultiPagePDFGeneration.ts` captures pages and creates PDF
5. `estimatePdfSaver.ts` uploads to storage

---

## Implementation Plan

### Phase 1: Seed Template Attachments (Database)

Insert records to link the Metal Roof Flyer to metal templates:

```sql
-- Link obc_-_metal_roof_flyer.pdf to all metal roof templates
INSERT INTO estimate_template_attachments (tenant_id, template_id, document_id, attachment_order)
SELECT 
  t.tenant_id,
  t.id as template_id,
  '9c38279e-4eff-47b2-9506-2a34897a8250' as document_id,
  0 as attachment_order
FROM estimate_templates t
WHERE t.roof_type = 'metal'
  OR t.name ILIKE '%5v%'
  OR t.name ILIKE '%standing seam%'
ON CONFLICT (template_id, document_id) DO NOTHING;
```

### Phase 2: Fetch Template Attachments During Estimate Creation

**File: `src/components/estimates/MultiTemplateSelector.tsx`**

Add a function to load attachments when a template is selected:

```typescript
// New state
const [templateAttachments, setTemplateAttachments] = useState<Array<{
  document_id: string;
  file_path: string;
  filename: string;
  attachment_order: number;
}>>([]);

// Fetch attachments when template is selected
const fetchTemplateAttachments = async (templateId: string) => {
  const { data, error } = await supabaseClient
    .from('estimate_template_attachments')
    .select(`
      document_id,
      attachment_order,
      documents!inner(file_path, filename)
    `)
    .eq('template_id', templateId)
    .order('attachment_order');
  
  if (data && !error) {
    setTemplateAttachments(data.map(d => ({
      document_id: d.document_id,
      file_path: d.documents.file_path,
      filename: d.documents.filename,
      attachment_order: d.attachment_order,
    })));
  }
};
```

### Phase 3: Create PDF Merge Utility

**New File: `src/lib/pdfMerger.ts`**

Create a utility to merge the estimate PDF with attachment PDFs:

```typescript
import { PDFDocument } from 'pdf-lib';

export async function mergeEstimateWithAttachments(
  estimatePdfBlob: Blob,
  attachmentUrls: string[]
): Promise<Blob> {
  // Load the base estimate PDF
  const estimateBytes = await estimatePdfBlob.arrayBuffer();
  const mergedPdf = await PDFDocument.load(estimateBytes);
  
  // Fetch and merge each attachment
  for (const url of attachmentUrls) {
    try {
      const response = await fetch(url);
      const attachmentBytes = await response.arrayBuffer();
      const attachmentPdf = await PDFDocument.load(attachmentBytes);
      
      // Copy all pages from attachment
      const pages = await mergedPdf.copyPages(
        attachmentPdf,
        attachmentPdf.getPageIndices()
      );
      pages.forEach(page => mergedPdf.addPage(page));
    } catch (err) {
      console.error('Failed to merge attachment:', url, err);
    }
  }
  
  // Return merged PDF as blob
  const mergedBytes = await mergedPdf.save();
  return new Blob([mergedBytes], { type: 'application/pdf' });
}
```

### Phase 4: Integrate Merging into Estimate Save Flow

**File: `src/components/estimates/MultiTemplateSelector.tsx`**

After PDF generation, merge attachments before upload:

```typescript
// In handleCreateEstimate, after generating pdfBlob:
if (pdfBlob && templateAttachments.length > 0) {
  // Get storage URLs for attachment documents
  const attachmentUrls = templateAttachments.map(att => {
    const { data } = supabase.storage
      .from('smartdoc-assets')
      .getPublicUrl(att.file_path);
    return data.publicUrl;
  });
  
  // Merge estimate with attachments
  const { mergeEstimateWithAttachments } = await import('@/lib/pdfMerger');
  pdfBlob = await mergeEstimateWithAttachments(pdfBlob, attachmentUrls);
  console.log('📎 Merged', templateAttachments.length, 'attachments into estimate PDF');
}
```

### Phase 5: Add pdf-lib Dependency

Update package.json to include the PDF merging library:

```json
"pdf-lib": "^1.17.1"
```

---

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| New migration | Create | Seed template attachments for metal templates |
| `src/lib/pdfMerger.ts` | Create | PDF merge utility using pdf-lib |
| `src/components/estimates/MultiTemplateSelector.tsx` | Modify | Fetch attachments, merge into final PDF |
| `package.json` | Modify | Add pdf-lib dependency |

---

## Technical Flow Diagram

```text
User selects "5V Painted Metal" template
         │
         ▼
┌─────────────────────────────────┐
│  Fetch template attachments     │
│  from estimate_template_attachments │
│  → Returns: obc_-_metal_roof_flyer.pdf │
└─────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│  Generate estimate PDF pages    │
│  (Cover page, line items, etc.) │
└─────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│  Merge with attachment PDFs     │
│  using pdf-lib                  │
│  → Final PDF: Estimate + Flyer  │
└─────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│  Upload merged PDF to storage   │
│  Save to enhanced_estimates     │
└─────────────────────────────────┘
```

---

## Existing Templates to Link

Based on database query, these templates will get the Metal Roof Flyer attachment:
- **Standard Metal Roof** (roof_type: metal)
- **5V Painted Metal with Polyglass XFR** (name contains '5V')
- Any future templates with roof_type = 'metal' or name containing '5v' or 'standing seam'

---

## Testing After Implementation

1. Open a lead and go to Estimates
2. Select a metal roof template (5V or Standard Metal)
3. Add line items and save the estimate
4. Open the saved estimate PDF
5. Verify the Metal Roofing flyer appears as additional pages at the end
