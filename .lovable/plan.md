
# Multi-Part Enhancement: Scanner Fix, Template Attachments & Estimate Cover Pages

## Issues to Address

| Issue | Root Cause | Solution |
|-------|------------|----------|
| image.jpg saved as JPG in Company Docs | SmartDocs accepts ANY file type - no validation | Add file type validation to only allow PDFs for company docs |
| OBC vs SS PDF needs auto-assignment to 5V/Standing Seam templates | No template-to-document linking system exists | Create template attachment system |
| Estimate cover pages needed | PDFs currently have no cover page option | Add cover page feature to estimate builder |

---

## Part 1: Company Docs File Type Validation

**Problem:** The Company Docs upload in SmartDocs accepts any file type (images, PDFs, etc). The user uploaded "image.jpg" which shouldn't be a company document.

**Solution:** Add validation to only accept PDF files for Company Documents, or at minimum warn users that images aren't recommended.

### File: `src/features/documents/components/SmartDocs.tsx`

Add file type validation before upload:

```typescript
const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
  const file = event.target.files?.[0];
  if (!file) return;

  // Validate file type - only PDFs recommended for company docs
  const allowedTypes = ['application/pdf'];
  if (!allowedTypes.includes(file.type)) {
    toast.error("Only PDF files are accepted for Company Documents");
    return;
  }
  // ... rest of upload logic
};
```

Also update the file input to hint at PDF-only:

```typescript
<input
  type="file"
  accept=".pdf,application/pdf"
  ...
/>
```

---

## Part 2: Template Attachment System (OBC vs SS Document)

**Goal:** Allow company documents to be automatically attached to estimates when using specific templates (e.g., 5V Metal, Standing Seam templates).

### Database Changes

Create a new junction table linking templates to company documents:

```sql
CREATE TABLE estimate_template_attachments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  template_id UUID REFERENCES estimate_templates(id) ON DELETE CASCADE,
  document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
  attachment_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(template_id, document_id)
);

-- Enable RLS
ALTER TABLE estimate_template_attachments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage attachments for their tenant templates"
ON estimate_template_attachments
FOR ALL
USING (tenant_id IN (
  SELECT p.active_tenant_id FROM profiles p WHERE p.id = auth.uid()
  UNION
  SELECT p.tenant_id FROM profiles p WHERE p.id = auth.uid()
));
```

### UI Components

**1. TemplateAttachmentManager component:**
- Shows current attachments for a template
- Allows selecting company docs to attach
- Sets attachment order

**2. Integration with estimate template editor:**
- Add "Attachments" section to template settings
- Show linked documents with drag-to-reorder

**3. PDF generation update:**
- When saving estimate, check if template has attachments
- Merge attachment PDFs after estimate pages

### File Changes

| File | Change |
|------|--------|
| New: `src/components/estimates/TemplateAttachmentManager.tsx` | UI to manage template-document links |
| `src/components/estimates/MultiTemplateSelector.tsx` | Load attachments, merge into PDF on save |
| New migration | Create `estimate_template_attachments` table |

---

## Part 3: Estimate Cover Page Feature

**Goal:** Add a professional cover page option when creating estimates, making them look more polished.

### Cover Page Design

```text
+------------------------------------------+
|                                          |
|          [COMPANY LOGO]                  |
|                                          |
|       ROOFING ESTIMATE                   |
|                                          |
|  Prepared for:                           |
|  [Customer Name]                         |
|  [Property Address]                      |
|                                          |
|  Estimate #: [EST-XXXX]                  |
|  Date: [Date]                            |
|                                          |
|  +------------------------------------+  |
|  |                                    |  |
|  |    [PROPERTY PHOTO or MAP]         |  |
|  |                                    |  |
|  +------------------------------------+  |
|                                          |
|  Prepared by:                            |
|  [Company Name]                          |
|  [Company Address]                       |
|  [Phone] | [Email]                       |
|  License #: [Number]                     |
|                                          |
+------------------------------------------+
```

### Implementation

**1. New Component: EstimateCoverPage.tsx**

```typescript
interface EstimateCoverPageProps {
  companyInfo: CompanyInfo;
  companyLogo?: string;
  customerName: string;
  customerAddress: string;
  estimateNumber: string;
  createdAt: string;
  propertyPhoto?: string; // Optional property image
}

export const EstimateCoverPage: React.FC<EstimateCoverPageProps> = ({...}) => {
  return (
    <div 
      data-report-page
      className="bg-white flex flex-col items-center justify-center"
      style={{ width: '816px', height: '1056px' }}
    >
      {/* Cover page content */}
    </div>
  );
};
```

**2. Update PDFComponentOptions.ts:**

Add new options for cover page:

```typescript
export interface PDFComponentOptions {
  // ... existing options
  showCoverPage: boolean;
  coverPagePropertyPhoto?: string;
}

export function getDefaultOptions(mode: 'internal' | 'customer'): PDFComponentOptions {
  return {
    // ... existing
    showCoverPage: true, // Default ON for customer-facing
  };
}
```

**3. Update EstimatePDFDocument.tsx:**

Insert cover page as first page when enabled:

```typescript
// In useMemo for pages
if (opts.showCoverPage) {
  totalPageCount++;
  pageList.unshift(
    <EstimateCoverPage
      key="cover-page"
      companyInfo={companyInfo}
      companyLogo={companyLogo}
      customerName={customerName}
      customerAddress={customerAddress}
      estimateNumber={estimateNumber}
      createdAt={createdAt}
    />
  );
}
```

**4. Update MultiTemplateSelector.tsx:**

Add UI toggle for cover page in the export options:

```typescript
{/* Add Cover Page toggle in export options section */}
<div className="flex items-center space-x-2">
  <Checkbox
    id="showCoverPage"
    checked={pdfOptions.showCoverPage}
    onCheckedChange={(checked) => 
      setPdfOptions(prev => ({ ...prev, showCoverPage: !!checked }))
    }
  />
  <Label htmlFor="showCoverPage">Include Cover Page</Label>
</div>
```

---

## Implementation Summary

| Phase | Component | Priority |
|-------|-----------|----------|
| 1 | Company Docs PDF-only validation | High |
| 2 | Create `estimate_template_attachments` table | High |
| 3 | TemplateAttachmentManager UI | Medium |
| 4 | EstimateCoverPage component | High |
| 5 | Cover page toggle in export options | High |
| 6 | PDF merge for template attachments | Medium |

---

## Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/features/documents/components/SmartDocs.tsx` | Modify | Add PDF-only validation |
| `src/components/estimates/EstimateCoverPage.tsx` | Create | Cover page component |
| `src/components/estimates/PDFComponentOptions.ts` | Modify | Add showCoverPage option |
| `src/components/estimates/EstimatePDFDocument.tsx` | Modify | Render cover page as first page |
| `src/components/estimates/MultiTemplateSelector.tsx` | Modify | Add cover page toggle |
| `src/components/estimates/TemplateAttachmentManager.tsx` | Create | UI for template-doc links |
| New migration | Create | `estimate_template_attachments` table |

---

## Data Cleanup

Remove the incorrectly uploaded image.jpg from Company Docs:

```sql
DELETE FROM documents 
WHERE id = '90464293-b371-4b97-8436-53a2b5cf0953';
```

Then delete from storage:
```sql
-- Storage: smartdoc-assets/company-docs/1770119019387-image.jpg
```
