
# SmartDocs Production Enhancement Plan
## Adobe-Style PDF Builder + DocuSign-Style E-Signature Workflow

---

## Executive Summary

This project already has **significant infrastructure** in place for SmartDocs and e-signatures. The goal is to enhance and unify these components into a polished, production-grade document builder with comprehensive e-signature and view-tracking capabilities.

---

## Current State Analysis

### What's Already Built

| Component | Status | Notes |
|-----------|--------|-------|
| **SmartDocs Base** | ✅ Exists | `src/features/documents/components/SmartDocs.tsx` - Template management, folder organization |
| **Document Tag Editor** | ✅ Exists | Fabric.js canvas-based PDF overlay editor with smart tag positioning |
| **Smart Tag Categories** | ✅ Exists | Contact, Job, Project, Financial, Estimate, Measurement, Company, Sales Rep, Insurance, Date, Signatures, Checkboxes |
| **Signature Envelopes** | ✅ Exists | `signature_envelopes`, `signature_recipients`, `digital_signatures` tables |
| **Submit Signature** | ✅ Exists | Edge function with consent capture, IP/user-agent logging |
| **Finalize Envelope** | ✅ Exists | PDF generation with signature certificate page using pdf-lib |
| **Share Links** | ✅ Exists | `share_links` table with token hashing, expiration, permissions |
| **View Event Tracking** | ✅ Exists | `record-view-event` edge function with notifications |
| **Signer Open** | ✅ Exists | Token validation and envelope access |
| **Public Signing Page** | ✅ Exists | `/sign/:token` route with draw/type signature capture |
| **Smart Tag Engine** | ✅ Exists | `src/lib/smartTags/smartTagEngine.ts` - Tag resolution |
| **PDF Generation** | ✅ Exists | `smart-docs-pdf` edge function using Puppeteer |
| **Audit Logging** | ✅ Exists | `logAuditEvent` utility function |
| **Notifications** | ✅ Exists | `createNotification` utility |

### What Needs Enhancement

| Gap | Priority | Description |
|-----|----------|-------------|
| **View Link Page** | High | `/v/:token` public view page that calls `record-view-event` on every load |
| **PDF Overlay Editor** | High | Add text boxes, images, shapes, page reorder, merge/split, headers/footers |
| **Template Designer** | High | pdfme-style WYSIWYG template builder with drag-drop smart tags |
| **Version History** | Medium | Document versioning with timeline and revert |
| **Envelope Builder UI** | Medium | Dedicated UI for managing recipients, routing, field placement |
| **Real-time Notifications** | Medium | Supabase Realtime for instant view event alerts |
| **Smart Tag Admin** | Medium | Admin UI to define/test smart tags against sample contexts |
| **Email Integration** | High | Resend integration for sending envelopes and completion notices |

---

## Architecture Overview

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                           SMARTDOCS SYSTEM                              │
├─────────────────────────────────────────────────────────────────────────┤
│  FRONTEND (React + TypeScript + Tailwind)                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │  Template    │  │  Document    │  │  Envelope    │  │  Public      │ │
│  │  Designer    │  │  Editor      │  │  Manager     │  │  Views       │ │
│  │  (pdfme)     │  │  (Konva)     │  │  (Fields)    │  │  (Sign/View) │ │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘ │
├─────────────────────────────────────────────────────────────────────────┤
│  EDGE FUNCTIONS (Deno)                                                  │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │ create-share-link | record-view-event | signer-open | submit-sig  │ │
│  │ finalize-envelope | send-envelope | render-from-template          │ │
│  └────────────────────────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────────────────────────┤
│  SUPABASE (Postgres + Storage + Auth + Realtime)                        │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │  Templates   │  │  Documents   │  │  Envelopes   │  │  Audit Log   │ │
│  │  + Versions  │  │  + Versions  │  │  + Recipients│  │  + Events    │ │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘ │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Plan

### Phase 1: View Link Page with Event Tracking (Priority: Critical)

**Goal:** Create `/v/:token` page that notifies owner every time it's opened.

**New Files:**
- `src/pages/PublicDocumentView.tsx` - Public view page
- Update `src/App.tsx` - Add route

**Implementation:**
1. Parse token from URL
2. Call `record-view-event` edge function immediately on mount
3. Exchange token for document metadata via new edge function
4. Display PDF in iframe or pdf.js viewer
5. Show document title and minimal branding

**Key Code Pattern:**
```typescript
// On component mount
useEffect(() => {
  if (token) {
    // Record view event FIRST (critical requirement)
    supabase.functions.invoke('record-view-event', {
      body: { token, session_id: crypto.randomUUID() }
    });
    
    // Then load document
    loadDocumentForViewing(token);
  }
}, [token]);
```

---

### Phase 2: Enhanced PDF Overlay Editor

**Goal:** Add professional editing tools to existing DocumentTagEditor.

**Modifications to:** `src/features/documents/components/DocumentTagEditor.tsx`

**New Capabilities:**
- Text box tool (add arbitrary text anywhere)
- Image insertion (from storage or upload)
- Shape tools (rectangle, circle, line, arrow)
- Highlight/redaction tools
- Page navigation for multi-page PDFs
- Page reorder via drag-drop thumbnail sidebar
- Undo/Redo stack
- Autosave with debounce

**New Files:**
- `src/features/documents/components/EditorToolbar.tsx`
- `src/features/documents/components/PageThumbnails.tsx`
- `src/features/documents/hooks/useEditorHistory.ts`

---

### Phase 3: Template Designer with Smart Tag Binding

**Goal:** WYSIWYG template builder where users drag smart tags onto positioned fields.

**New Files:**
- `src/features/documents/components/TemplateDesigner.tsx`
- `src/features/documents/components/SmartTagPalette.tsx`
- `src/features/documents/components/FieldPropertiesPanel.tsx`

**Features:**
- Upload base PDF or create from HTML
- Drag smart tags from sidebar onto document
- Configure field properties (size, font, required)
- Preview with sample data
- Save template + version

---

### Phase 4: Envelope Builder UI

**Goal:** Full-featured UI for creating and managing signature requests.

**New Files:**
- `src/pages/EnvelopeBuilder.tsx`
- `src/features/documents/components/RecipientManager.tsx`
- `src/features/documents/components/FieldPlacer.tsx`
- `src/features/documents/components/RoutingConfig.tsx`

**Features:**
- Add recipients with roles and routing order
- Place signature/initial/date fields per recipient
- Set reminders and expiration
- Preview before sending
- Send via Resend email

---

### Phase 5: Version History & Audit Trail

**Goal:** Complete document history with revert capability.

**Database Changes:**
- Add `document_versions` table if not exists
- Add `template_versions` table if not exists

**New UI Components:**
- `src/features/documents/components/VersionTimeline.tsx`
- `src/features/documents/components/AuditTrailViewer.tsx`

---

### Phase 6: Real-time Notifications

**Goal:** Instant in-app alerts when documents are viewed.

**Implementation:**
- Subscribe to `user_notifications` table via Supabase Realtime
- Show toast notifications for view events
- Update notification badge in header

---

## Database Schema Additions

### New Tables Required

```sql
-- Template versions for tracking changes
CREATE TABLE IF NOT EXISTS template_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID REFERENCES smartdoc_templates(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  base_pdf_path TEXT,
  template_json JSONB NOT NULL DEFAULT '{}',
  header_footer_json JSONB,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(template_id, version)
);

-- Document versions for edit history
CREATE TABLE IF NOT EXISTS document_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID REFERENCES documents(id) ON DELETE CASCADE,
  version INTEGER NOT NULL DEFAULT 1,
  overlay_ops JSONB NOT NULL DEFAULT '[]',
  generated_pdf_path TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(document_id, version)
);

-- Envelope fields for positioned signature elements
CREATE TABLE IF NOT EXISTS envelope_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  envelope_id UUID REFERENCES signature_envelopes(id) ON DELETE CASCADE,
  recipient_id UUID REFERENCES signature_recipients(id),
  field_type TEXT NOT NULL CHECK (field_type IN ('signature', 'initial', 'date', 'text', 'checkbox')),
  page INTEGER NOT NULL DEFAULT 1,
  x DECIMAL(10,2) NOT NULL,
  y DECIMAL(10,2) NOT NULL,
  width DECIMAL(10,2) NOT NULL DEFAULT 150,
  height DECIMAL(10,2) NOT NULL DEFAULT 50,
  required BOOLEAN DEFAULT true,
  smart_tag_key TEXT,
  label TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### RLS Policies

```sql
-- Template versions: org members only
ALTER TABLE template_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org members can manage template versions" ON template_versions
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM smartdoc_templates t
      WHERE t.id = template_id
      AND t.tenant_id = get_user_tenant_id(auth.uid())
    )
  );

-- Document versions: org members only  
ALTER TABLE document_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org members can manage document versions" ON document_versions
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM documents d
      WHERE d.id = document_id
      AND d.tenant_id = get_user_tenant_id(auth.uid())
    )
  );

-- Envelope fields: org members only
ALTER TABLE envelope_fields ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Org members can manage envelope fields" ON envelope_fields
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM signature_envelopes e
      WHERE e.id = envelope_id
      AND e.tenant_id = get_user_tenant_id(auth.uid())
    )
  );
```

---

## Edge Functions to Create/Enhance

### 1. New: `validate-view-token`

Token exchange for public view pages (returns minimal safe payload).

```typescript
// Returns: { target_type, target_id, title, pdf_url, permissions }
// Does NOT expose tenant data
```

### 2. Enhance: `send-envelope` 

Add Resend email integration:
- Send personalized signing invitation emails
- Include recipient's access token in URL
- Track email delivery status

### 3. New: `render-document-from-template`

Resolve smart tags and generate PDF:
- Load template + context data
- Call `resolveSmartTags()` 
- Generate PDF with positioned values
- Store as document version

---

## Files to Create/Modify Summary

### New Pages
| File | Purpose |
|------|---------|
| `src/pages/PublicDocumentView.tsx` | `/v/:token` view page |
| `src/pages/EnvelopeBuilder.tsx` | Create/manage envelopes |
| `src/pages/TemplateDesigner.tsx` | WYSIWYG template editor |

### New Components
| File | Purpose |
|------|---------|
| `src/features/documents/components/EditorToolbar.tsx` | PDF editing tools |
| `src/features/documents/components/PageThumbnails.tsx` | Multi-page navigation |
| `src/features/documents/components/SmartTagPalette.tsx` | Drag-drop tag picker |
| `src/features/documents/components/RecipientManager.tsx` | Envelope recipients |
| `src/features/documents/components/FieldPlacer.tsx` | Position signature fields |
| `src/features/documents/components/VersionTimeline.tsx` | History browser |
| `src/features/documents/components/AuditTrailViewer.tsx` | Compliance log |

### New Edge Functions
| File | Purpose |
|------|---------|
| `supabase/functions/validate-view-token/index.ts` | Safe token exchange |
| `supabase/functions/render-document-from-template/index.ts` | PDF generation |

### Modifications
| File | Changes |
|------|---------|
| `src/App.tsx` | Add `/v/:token` route |
| `src/features/documents/components/DocumentTagEditor.tsx` | Add editing tools |
| `supabase/functions/send-signature-envelope/index.ts` | Add Resend emails |

---

## Libraries Already Installed

The project already has all required libraries:
- `fabric` - Canvas editing
- `react-konva` + `konva` - Alternative canvas
- `pdfjs-dist` - PDF rendering
- `jspdf` - PDF generation
- `pdf-lib` is imported in edge functions

No new npm dependencies needed.

---

## Security Considerations

1. **Token hashing:** All share link tokens are SHA-256 hashed before storage
2. **RLS enforcement:** Every table has tenant-scoped policies
3. **Minimal exposure:** Token endpoints return only necessary data
4. **Audit logging:** Every significant action logged with IP/user-agent
5. **Consent capture:** E-signatures require explicit consent checkbox
6. **Tamper evidence:** Final PDFs include SHA-256 hash in metadata

---

## Recommended Implementation Order

1. **Phase 1:** Public view page with event tracking (1-2 hours)
2. **Phase 2:** Enhanced editor toolbar (2-3 hours)
3. **Phase 3:** Template designer (3-4 hours)
4. **Phase 4:** Envelope builder (3-4 hours)
5. **Phase 5:** Version history (2-3 hours)
6. **Phase 6:** Real-time notifications (1-2 hours)

**Total estimated effort:** 12-18 hours

---

## Success Criteria

- View link page records event on every single open
- Document owner receives notification within 2 seconds of view
- Templates can position smart tags with x/y coordinates
- Signatures are captured with full audit trail
- Final PDFs are flattened with certificate page
- All data isolated by tenant via RLS
