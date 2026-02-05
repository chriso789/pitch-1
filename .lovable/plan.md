
# Implementation Plan: Four Core Feature Completions

This plan addresses four incomplete features identified in the internal audit: Labor Line Items, Proposal PDF Download, Dialer SMS/Email Buttons, and Send for Signature integration.

---

## Feature 1: Labor Line Items Tab in AddEstimateLineDialog

### Current State
- The Labor tab exists but shows a placeholder message: "Labor line items coming soon..."
- Database has a `labor_rates` table with columns: `id`, `tenant_id`, `job_type`, `skill_level`, `base_rate_per_hour`, `location_zone`, `seasonal_adjustment`, `complexity_multiplier`, `effective_date`, `expires_date`, `is_active`

### Implementation

**Files to Create:**
| File | Purpose |
|------|---------|
| `src/hooks/useLaborRates.ts` | React Query hook to fetch labor rates |

**Files to Modify:**
| File | Changes |
|------|---------|
| `src/components/estimates/AddEstimateLineDialog.tsx` | Build out the Labor tab UI |

### Labor Tab UI Design

```text
┌─────────────────────────────────────────────────────────────┐
│  LABOR LINE ITEM                                            │
│                                                             │
│  Job Type:        [Roofing Installation ▼]                  │
│  Skill Level:     [Journeyman ▼]                            │
│                                                             │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Current Rate: $55.00/hr                               │ │
│  │  Complexity: 1.15x  |  Seasonal: 1.00x                 │ │
│  │  Effective Rate: $63.25/hr                             │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                             │
│  ☑ Use Formula (Calculate from measurements)               │
│                                                             │
│  Formula:  [{{ measure.surface_squares }} * 2.5 hours]      │
│  Hours:    12.5 (calculated)                                │
│                                                             │
│  Manual Hours: [____] (if formula disabled)                 │
│  Markup %:     [15.0]                                       │
│  Description:  [Roofing labor - journeyman crew]            │
│                                                             │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  Total: 12.5 hrs × $63.25/hr = $790.63                 │ │
│  │  With 15% markup: $909.22                              │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                             │
│  [Add Labor Line Item]                                      │
└─────────────────────────────────────────────────────────────┘
```

### Labor Tab Logic

1. **Load labor rates** from `labor_rates` table filtered by `is_active = true` and within date range
2. **Job Type dropdown** options: Roofing Installation, Roofing Repair, Gutter Install, Siding, etc.
3. **Skill Level dropdown**: Apprentice, Journeyman, Master, Foreman
4. **Calculate effective rate**: `base_rate * complexity_multiplier * seasonal_adjustment`
5. **Formula presets** for labor hours:
   - "Per Square Installation": `{{ measure.surface_squares }} * 2.5`
   - "Per LF Gutter": `{{ measure.eave_lf }} * 0.15`
   - "Tear-off Labor": `{{ measure.surface_squares }} * 1.5`
6. **Output line item** with: `item_name`, `description`, `quantity` (hours), `unit_cost` (hourly rate), `unit_type: 'HR'`, `markup_percent`

---

## Feature 2: PDF Download in ProposalBuilder

### Current State
- `ProposalPreview.tsx` has Download PDF button that calls `onDownload` prop
- `ProposalBuilder.tsx` passes a placeholder handler: `toast({ title: 'Download', description: 'PDF download coming soon' })`
- `pdf-lib` is already installed and used in `src/lib/pdfMerger.ts`
- `useProposalPreview` returns HTML content that can be rendered

### Implementation

**Files to Create:**
| File | Purpose |
|------|---------|
| `src/lib/proposalPdfGenerator.ts` | Convert proposal HTML to PDF using html2canvas + jsPDF |

**Files to Modify:**
| File | Changes |
|------|---------|
| `src/components/proposals/ProposalBuilder.tsx` | Implement actual PDF download handler |
| `src/components/proposals/ProposalPreview.tsx` | Add loading state during PDF generation |

### PDF Generation Flow

```typescript
// src/lib/proposalPdfGenerator.ts
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

export async function generateProposalPdf(
  htmlContent: string,
  filename: string
): Promise<Blob> {
  // 1. Create hidden container with the HTML
  const container = document.createElement('div');
  container.innerHTML = htmlContent;
  container.style.cssText = 'position: absolute; left: -9999px; width: 816px;'; // Letter width
  document.body.appendChild(container);

  try {
    // 2. Render to canvas
    const canvas = await html2canvas(container, {
      scale: 2,
      useCORS: true,
      logging: false,
    });

    // 3. Create PDF
    const pdf = new jsPDF('p', 'pt', 'letter');
    const imgData = canvas.toDataURL('image/png');
    const imgWidth = 612; // Letter width in points
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    
    // Handle multi-page
    let heightLeft = imgHeight;
    let position = 0;
    const pageHeight = 792; // Letter height

    pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;

    while (heightLeft > 0) {
      position -= pageHeight;
      pdf.addPage();
      pdf.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;
    }

    return pdf.output('blob');
  } finally {
    document.body.removeChild(container);
  }
}
```

### ProposalBuilder Download Handler

```typescript
const handleDownloadPdf = async () => {
  if (!estimateId) return;
  
  setDownloading(true);
  try {
    // Fetch the HTML preview
    const { data: previewData } = await supabase.functions.invoke('generate-proposal', {
      body: { action: 'preview', estimateId },
    });
    
    if (!previewData?.html) throw new Error('No preview data');
    
    // Generate PDF
    const pdfBlob = await generateProposalPdf(
      previewData.html,
      `Proposal-${estimateId}.pdf`
    );
    
    // Trigger download
    const url = URL.createObjectURL(pdfBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Proposal-${estimateId}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
    
    toast.success('PDF downloaded successfully');
  } catch (error) {
    console.error('PDF generation error:', error);
    toast.error('Failed to generate PDF');
  } finally {
    setDownloading(false);
  }
};
```

---

## Feature 3: Dialer SMS/Email Buttons

### Current State
- `ContactHeader.tsx` receives `onText` and `onEmail` callbacks
- `Dialer.tsx` passes placeholder handlers: `toast({ title: "SMS", description: "SMS feature coming soon" })`
- `useSendSMS` hook exists and works with `telnyx-send-sms` edge function
- Edge function is fully implemented with multi-tenant location-based routing

### Implementation

**Files to Create:**
| File | Purpose |
|------|---------|
| `src/components/communication/QuickSMSDialog.tsx` | Modal for composing quick SMS |
| `src/components/communication/QuickEmailDialog.tsx` | Modal for composing quick email |

**Files to Modify:**
| File | Changes |
|------|---------|
| `src/features/communication/components/Dialer.tsx` | Replace placeholder handlers with real dialogs |

### QuickSMSDialog Component

```typescript
interface QuickSMSDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact: {
    id: string;
    name: string;
    phone: string;
  };
}

// Features:
// - Pre-populated recipient phone
// - Message textarea with character count
// - Template quick-insert dropdown
// - Send button using useSendSMS hook
// - Real-time delivery status feedback
```

### Dialer.tsx Integration

```typescript
const [smsDialogOpen, setSmsDialogOpen] = useState(false);
const [emailDialogOpen, setEmailDialogOpen] = useState(false);

// In ContactHeader props:
onText={() => currentContact?.phone && setSmsDialogOpen(true)}
onEmail={() => currentContact?.email && setEmailDialogOpen(true)}

// Add dialogs:
<QuickSMSDialog
  open={smsDialogOpen}
  onOpenChange={setSmsDialogOpen}
  contact={currentContact}
/>
<QuickEmailDialog
  open={emailDialogOpen}
  onOpenChange={setEmailDialogOpen}
  contact={currentContact}
/>
```

---

## Feature 4: Send for Signature in ApplyDocumentToLeadDialog

### Current State
- Button exists but shows: `toast.info("Send for signature functionality coming soon")`
- `RequestSignatureDialog.tsx` exists and calls `send-document-for-signature` edge function
- Edge function is fully implemented at `supabase/functions/send-document-for-signature/index.ts`
- SmartDocs system has envelope/signature workflow ready

### Implementation

**Files to Modify:**
| File | Changes |
|------|---------|
| `src/features/documents/components/ApplyDocumentToLeadDialog.tsx` | Integrate RequestSignatureDialog |

### Integration Logic

```typescript
// Add state
const [signatureDialogOpen, setSignatureDialogOpen] = useState(false);

// Replace button handler
<Button
  onClick={() => setSignatureDialogOpen(true)}
  className="gap-2"
>
  <Send className="h-4 w-4" />
  Send for Signature
</Button>

// Add dialog
<RequestSignatureDialog
  open={signatureDialogOpen}
  onClose={() => setSignatureDialogOpen(false)}
  documentId={document.id}
  documentType="smart_doc_instance"
  documentTitle={document.filename}
  defaultRecipient={{
    name: `${selectedContact.first_name} ${selectedContact.last_name}`,
    email: selectedContact.email || ''
  }}
  onSuccess={(envelopeId) => {
    toast.success('Document sent for signature');
    onOpenChange(false);
  }}
/>
```

---

## Summary of Changes

| Feature | Files Created | Files Modified |
|---------|---------------|----------------|
| Labor Line Items | `useLaborRates.ts` | `AddEstimateLineDialog.tsx` |
| PDF Download | `proposalPdfGenerator.ts` | `ProposalBuilder.tsx`, `ProposalPreview.tsx` |
| Dialer SMS/Email | `QuickSMSDialog.tsx`, `QuickEmailDialog.tsx` | `Dialer.tsx` |
| Send for Signature | None | `ApplyDocumentToLeadDialog.tsx` |

## Dependencies
- **html2canvas** (already installed) - for PDF generation
- **jsPDF** (already installed) - for PDF creation
- **pdf-lib** (already installed) - available for advanced PDF manipulation

## Testing Plan

1. **Labor Line Items**
   - Open estimate builder → Add Line Item → Labor tab
   - Select job type and skill level
   - Verify rate calculation with multipliers
   - Test formula-based hour calculation
   - Add labor line and verify in estimate

2. **PDF Download**
   - Create a proposal through the builder
   - Click "Download PDF" button
   - Verify PDF contains all proposal content
   - Check multi-page handling for long proposals

3. **Dialer SMS/Email**
   - Navigate to Dialer with a contact
   - Click "Text" button → SMS dialog opens
   - Compose and send message → verify delivery
   - Click "Email" button → Email composer opens

4. **Send for Signature**
   - Go to SmartDocs → Apply to Lead
   - Select a contact → Click "Send for Signature"
   - Verify RequestSignatureDialog opens
   - Complete signature workflow → verify envelope created
