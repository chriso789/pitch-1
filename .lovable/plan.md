
# Scope Intelligence System - Implementation Plan

## Executive Summary

Build a comprehensive "Scope Intelligence" system that transforms uploaded insurance estimate PDFs into structured, searchable data with evidence tracking. This enables supplement teams to prove "carrier paid for this before" with page-level evidence.

---

## Current State Analysis

### What Exists Today

| Component | Status | Gap |
|-----------|--------|-----|
| `insurance_claims` table | Basic claim tracking | No document storage, no line item extraction |
| `scope_documents` table | Manual line item entry | No PDF parsing, no evidence binding |
| `supplement_requests` table | Basic supplement tracking | No cross-reference to prior paid examples |
| `roof-report-ingest` function | PDF text extraction + AI | Only for measurement reports, not insurance scopes |
| `supplement-generator` function | AI-powered supplement creation | No evidence from prior scopes |
| `xactimate-exporter` function | Static Xactimate codes | No dynamic code mapping from ingested docs |

### Key Gaps to Fill

1. **No PDF ingestion for insurance scopes** - Currently only manual entry
2. **No canonical line item taxonomy** - Can't compare across carriers
3. **No evidence coordinates** - Can't highlight where values came from
4. **No cross-tenant intelligence** - Each company is isolated
5. **No price distribution analytics** - Can't show "typical paid range"

---

## System Architecture

### Data Flow

```text
 PDF Upload          Parse + Extract          Normalize          Evidence Vault
┌─────────────┐     ┌─────────────────┐     ┌───────────────┐     ┌──────────────┐
│ User uploads│ ──► │ PDF text + OCR  │ ──► │ Map to        │ ──► │ Searchable   │
│ scope PDF   │     │ Table detection │     │ canonical     │     │ evidence     │
│             │     │ AI extraction   │     │ items         │     │ database     │
└─────────────┘     └─────────────────┘     └───────────────┘     └──────────────┘
                           │                       │                     │
                           ▼                       ▼                     ▼
                    ┌─────────────┐         ┌───────────────┐     ┌──────────────┐
                    │ Page images │         │ Confidence    │     │ Supplement   │
                    │ for highlight│         │ scores        │     │ "Proof"      │
                    └─────────────┘         └───────────────┘     └──────────────┘
```

---

## Database Schema (New Tables)

### Phase 1: Document Vault

```sql
-- Raw documents with page-level storage
CREATE TABLE insurance_scope_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  insurance_claim_id UUID REFERENCES insurance_claims(id) ON DELETE SET NULL,
  job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  
  -- Document metadata
  document_type TEXT NOT NULL CHECK (document_type IN (
    'estimate', 'supplement', 'denial', 'policy', 'reinspection', 'final_settlement'
  )),
  file_name TEXT NOT NULL,
  file_hash TEXT NOT NULL, -- SHA-256 for deduplication
  file_size_bytes INTEGER,
  storage_path TEXT NOT NULL,
  
  -- Carrier/format detection
  carrier_name TEXT,
  carrier_normalized TEXT, -- e.g., "state_farm" from various spellings
  adjuster_name TEXT,
  claim_number_detected TEXT,
  loss_date_detected DATE,
  format_family TEXT, -- 'xactimate', 'symbility', 'corelogic', 'generic'
  
  -- Parsing status
  parse_status TEXT DEFAULT 'pending' CHECK (parse_status IN (
    'pending', 'extracting', 'parsing', 'mapping', 'complete', 'failed', 'needs_review'
  )),
  parse_started_at TIMESTAMPTZ,
  parse_completed_at TIMESTAMPTZ,
  parse_error TEXT,
  parser_version TEXT,
  
  -- Extracted raw text
  raw_text_content TEXT,
  raw_json_output JSONB,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES profiles(id),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Page-level storage for evidence highlighting
CREATE TABLE insurance_scope_document_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES insurance_scope_documents(id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL,
  page_image_path TEXT, -- Rendered page image for highlighting
  page_text_content TEXT,
  page_tables_json JSONB, -- Detected tables structure
  
  UNIQUE(document_id, page_number)
);
```

### Phase 2: Structured Scope Data

```sql
-- Header-level scope data (totals, metadata)
CREATE TABLE insurance_scope_headers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES insurance_scope_documents(id) ON DELETE CASCADE,
  
  -- Totals (ACV/RCV/Depreciation model)
  total_rcv DECIMAL(12,2),
  total_acv DECIMAL(12,2),
  total_depreciation DECIMAL(12,2),
  recoverable_depreciation DECIMAL(12,2),
  non_recoverable_depreciation DECIMAL(12,2),
  deductible DECIMAL(12,2),
  tax_amount DECIMAL(12,2),
  overhead_amount DECIMAL(12,2),
  profit_amount DECIMAL(12,2),
  total_net_claim DECIMAL(12,2),
  
  -- Supplements tracking
  supplement_count INTEGER DEFAULT 0,
  total_supplement_amount DECIMAL(12,2),
  
  -- Price list info (Xactimate-style)
  price_list_name TEXT,
  price_list_region TEXT,
  price_list_effective_date DATE,
  
  -- Metadata
  estimate_date DATE,
  property_address TEXT,
  property_city TEXT,
  property_state TEXT,
  property_zip TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Individual line items
CREATE TABLE insurance_scope_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  header_id UUID NOT NULL REFERENCES insurance_scope_headers(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES insurance_scope_documents(id) ON DELETE CASCADE,
  
  -- Raw extracted values (carrier-specific)
  raw_code TEXT,
  raw_description TEXT NOT NULL,
  raw_category TEXT,
  
  -- Quantities and pricing
  quantity DECIMAL(12,4),
  unit TEXT, -- SQ, SF, LF, EA, HR, BDL, etc.
  unit_price DECIMAL(12,4),
  total_rcv DECIMAL(12,2),
  
  -- Depreciation
  depreciation_percent DECIMAL(5,2),
  depreciation_amount DECIMAL(12,2),
  total_acv DECIMAL(12,2),
  age_years DECIMAL(5,2),
  life_years DECIMAL(5,2),
  
  -- Taxability
  is_taxable BOOLEAN,
  tax_amount DECIMAL(12,2),
  
  -- Labor/Material split (if present)
  labor_amount DECIMAL(12,2),
  material_amount DECIMAL(12,2),
  
  -- Canonical mapping (see next table)
  canonical_item_id UUID REFERENCES insurance_canonical_items(id),
  mapping_confidence DECIMAL(5,4), -- 0.0 to 1.0
  mapping_method TEXT, -- 'exact', 'fuzzy', 'ai', 'manual'
  
  -- Line order for reconstruction
  line_order INTEGER,
  section_name TEXT, -- e.g., "Roofing", "Gutters", "Interior"
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Phase 3: Canonical Taxonomy + Evidence

```sql
-- Canonical line item definitions (cross-carrier)
CREATE TABLE insurance_canonical_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Canonical key (e.g., ROOF_SHINGLE_ARCH_30YR)
  canonical_key TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  category TEXT NOT NULL, -- Roofing, Gutters, Siding, Interior, etc.
  subcategory TEXT,
  
  -- Common Xactimate selector (if applicable)
  xactimate_selector TEXT,
  
  -- Unit normalization
  standard_unit TEXT NOT NULL, -- Preferred unit (SQ, SF, LF, EA)
  alternate_units TEXT[], -- Other acceptable units
  
  -- Description patterns for matching
  description_patterns TEXT[], -- Regex patterns
  code_patterns TEXT[], -- Code patterns (RFG%, SDL%, etc.)
  
  -- Metadata
  is_labor BOOLEAN DEFAULT FALSE,
  is_material BOOLEAN DEFAULT FALSE,
  is_overhead BOOLEAN DEFAULT FALSE,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Mapping table: raw line items → canonical items
CREATE TABLE insurance_line_item_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Source
  carrier_normalized TEXT NOT NULL,
  raw_code TEXT,
  raw_description TEXT NOT NULL,
  
  -- Target
  canonical_item_id UUID NOT NULL REFERENCES insurance_canonical_items(id),
  
  -- Confidence and method
  confidence DECIMAL(5,4) NOT NULL,
  mapping_method TEXT NOT NULL, -- 'exact', 'fuzzy', 'ai', 'manual'
  
  -- Training data
  verified_by UUID REFERENCES profiles(id),
  verified_at TIMESTAMPTZ,
  usage_count INTEGER DEFAULT 1,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(carrier_normalized, raw_code, raw_description)
);

-- Evidence binding: where each value came from
CREATE TABLE insurance_scope_line_item_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  line_item_id UUID NOT NULL REFERENCES insurance_scope_line_items(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES insurance_scope_documents(id) ON DELETE CASCADE,
  
  -- Location in document
  page_number INTEGER NOT NULL,
  table_index INTEGER, -- Which table on the page
  row_index INTEGER, -- Which row in the table
  
  -- Bounding box for highlighting
  bbox_x DECIMAL(8,4),
  bbox_y DECIMAL(8,4),
  bbox_width DECIMAL(8,4),
  bbox_height DECIMAL(8,4),
  
  -- Text snippet
  snippet_text TEXT NOT NULL,
  snippet_hash TEXT NOT NULL, -- SHA-256 for change detection
  
  -- Field type
  field_type TEXT NOT NULL, -- 'code', 'description', 'quantity', 'unit_price', 'total', etc.
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Phase 4: Intelligence Network

```sql
-- Anonymized contributions for cross-company learning
CREATE TABLE insurance_network_contributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  -- Anonymized source
  contributor_hash TEXT NOT NULL, -- Hash of tenant_id (not reversible)
  consent_given_at TIMESTAMPTZ NOT NULL,
  consent_version TEXT,
  
  -- Anonymized fact
  carrier_normalized TEXT NOT NULL,
  state_code TEXT, -- 2-letter state
  loss_year INTEGER,
  canonical_item_id UUID NOT NULL REFERENCES insurance_canonical_items(id),
  
  -- Pricing data (ranges, not exact)
  quantity_bucket TEXT, -- '1-5', '6-10', '11-25', '26-50', '51+'
  unit_price_bucket TEXT, -- '$0-5', '$5-10', etc.
  
  -- Outcome
  was_paid BOOLEAN,
  was_disputed BOOLEAN,
  was_supplemented BOOLEAN,
  
  -- Conditions (for like-to-like comparison)
  pitch_category TEXT, -- 'walkable', 'steep', 'very_steep'
  story_count INTEGER,
  is_tearoff BOOLEAN,
  
  -- Redacted snippet (no PII)
  redacted_snippet TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Dispute tracking per job
CREATE TABLE insurance_scope_disputes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  job_id UUID REFERENCES jobs(id),
  insurance_claim_id UUID REFERENCES insurance_claims(id),
  
  -- What's being disputed
  canonical_item_id UUID REFERENCES insurance_canonical_items(id),
  disputed_line_item_id UUID REFERENCES insurance_scope_line_items(id),
  
  -- Dispute details
  dispute_reason TEXT NOT NULL,
  requested_amount DECIMAL(12,2),
  carrier_response TEXT,
  
  -- Status
  status TEXT DEFAULT 'pending' CHECK (status IN (
    'pending', 'submitted', 'approved', 'denied', 'partial', 'withdrawn'
  )),
  approved_amount DECIMAL(12,2),
  
  -- Evidence packet
  evidence_packet_id UUID REFERENCES insurance_supplement_packets(id),
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Generated evidence packets for supplements
CREATE TABLE insurance_supplement_packets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  
  -- Context
  job_id UUID REFERENCES jobs(id),
  insurance_claim_id UUID REFERENCES insurance_claims(id),
  
  -- Content
  title TEXT NOT NULL,
  items_json JSONB NOT NULL, -- Array of disputed items with evidence
  
  -- Prior paid examples included
  prior_examples_json JSONB, -- [{document_id, page, snippet, carrier, state, date}]
  
  -- Generated output
  pdf_url TEXT,
  html_content TEXT,
  
  -- Status
  status TEXT DEFAULT 'draft',
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Price distribution stats (pre-computed for performance)
CREATE MATERIALIZED VIEW insurance_price_statistics AS
SELECT 
  canonical_item_id,
  carrier_normalized,
  state_code,
  loss_year,
  
  COUNT(*) as sample_count,
  PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY unit_price) as p25_unit_price,
  PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY unit_price) as median_unit_price,
  PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY unit_price) as p75_unit_price,
  AVG(unit_price) as avg_unit_price,
  
  SUM(CASE WHEN was_paid THEN 1 ELSE 0 END)::DECIMAL / COUNT(*) as paid_rate,
  SUM(CASE WHEN was_disputed THEN 1 ELSE 0 END)::DECIMAL / COUNT(*) as dispute_rate
  
FROM insurance_network_contributions
WHERE was_paid IS NOT NULL
GROUP BY canonical_item_id, carrier_normalized, state_code, loss_year;
```

---

## Edge Functions

### 1. `scope-document-ingest` (New)

**Purpose:** Upload and parse insurance scope PDFs

```typescript
// Input
{
  file_url?: string;          // Public URL
  storage_path?: string;      // Supabase storage path
  base64_pdf?: string;        // Small PDFs only
  insurance_claim_id?: string;
  job_id?: string;
  document_type: 'estimate' | 'supplement' | 'denial' | ...;
}

// Processing Steps:
// 1. Download/decode PDF
// 2. Extract text + render page images
// 3. Detect carrier + format family
// 4. Extract tables with structure
// 5. Parse line items with bounding boxes
// 6. Map to canonical items
// 7. Store all with evidence links
```

### 2. `scope-document-classify` (New)

**Purpose:** Detect document type and carrier

```typescript
// Uses AI to classify:
// - Is this an estimate, supplement, denial, policy?
// - Which carrier (normalize spelling variations)
// - Is it Xactimate, Symbility, or other format?
```

### 3. `scope-line-item-mapper` (New)

**Purpose:** Map raw line items to canonical taxonomy

```typescript
// Processing:
// 1. Check exact match in mappings table
// 2. Try fuzzy match on code + description
// 3. Fall back to AI classification
// 4. Return confidence score + method
// 5. Queue low-confidence for human review
```

### 4. `scope-evidence-search` (New)

**Purpose:** Find prior paid examples for a disputed item

```typescript
// Input
{
  canonical_item_id: string;
  carrier_normalized?: string;
  state_code?: string;
  include_network?: boolean; // Cross-company data
  conditions?: {
    pitch_category?: string;
    story_count?: number;
    is_tearoff?: boolean;
  };
}

// Output
{
  internal_examples: [...],   // Same tenant
  network_examples: [...],    // Anonymized cross-tenant
  price_stats: {
    median: number;
    p25: number;
    p75: number;
    paid_rate: number;
  }
}
```

### 5. `scope-supplement-packet-generate` (New)

**Purpose:** Generate evidence packet PDF

```typescript
// Compiles:
// - Disputed item details
// - Prior paid examples with page highlights
// - Price statistics
// - Pre-written argument template
```

---

## UI Components

### 1. Scope Upload + Parse Status

**Location:** `src/components/insurance/ScopeUploader.tsx`

- Drag-drop PDF upload
- Progress indicator (extracting → parsing → mapping → complete)
- Error handling with retry
- Document type selector

### 2. Scope Viewer with Evidence Highlighting

**Location:** `src/components/insurance/ScopeViewer.tsx`

- Page-by-page PDF viewer
- Highlight bounding boxes for line items
- Click-to-select items
- Side panel with structured data

### 3. Line Item Mapping Review

**Location:** `src/components/insurance/LineItemMappingReview.tsx`

- Table of low-confidence mappings
- Suggest canonical items
- One-click approval
- Bulk operations

### 4. Dispute Evidence Builder

**Location:** `src/components/insurance/DisputeEvidenceBuilder.tsx`

- Select disputed items
- Search for prior examples
- Preview evidence packet
- Generate PDF

### 5. Intelligence Dashboard

**Location:** `src/components/insurance/ScopeIntelligenceDashboard.tsx`

- Price distribution charts by carrier
- Dispute success rates
- Trending denied items
- Network stats

---

## Canonical Item Seed Data

Initial taxonomy (~150 roofing items):

| Key | Display Name | Category | Xactimate |
|-----|--------------|----------|-----------|
| `ROOF_SHINGLE_3TAB_REMOVE` | Remove 3-Tab Shingles | Roofing | RFG RDCK |
| `ROOF_SHINGLE_ARCH_INSTALL` | Install Architectural Shingles | Roofing | RFG SHNG |
| `ROOF_UNDERLAYMENT_FELT15` | 15# Felt Underlayment | Roofing | RFG FELT |
| `ROOF_ICE_WATER_SHIELD` | Ice & Water Shield | Roofing | RFG ICEW |
| `ROOF_DRIP_EDGE_ALUMINUM` | Aluminum Drip Edge | Roofing | RFG DRPE |
| `ROOF_RIDGE_CAP` | Ridge Cap Shingles | Roofing | RFG RDGC |
| `ROOF_STARTER_STRIP` | Starter Strip | Roofing | RFG STRT |
| `ROOF_VALLEY_METAL` | Valley Metal | Roofing | RFG VALY |
| `ROOF_STEP_FLASHING` | Step Flashing | Roofing | RFG FLSH |
| `ROOF_PIPE_BOOT` | Pipe Boot/Jack | Roofing | RFG BOOT |
| `ROOF_VENT_BOX` | Box Vent | Roofing | RFG VENT |
| `ROOF_RIDGE_VENT` | Ridge Vent | Roofing | RFG RDGV |
| `ROOF_DECKING_OSB` | OSB Roof Decking | Roofing | RFG DECK |
| `ROOF_STEEP_CHARGE` | Steep Pitch Charge | Roofing | RFG STEE |
| `ROOF_HIGH_CHARGE` | High Roof Charge | Roofing | RFG HIGH |
| `GUTTER_SEAMLESS_5` | 5" Seamless Gutter | Gutters | GTR ALUM |
| `GUTTER_DOWNSPOUT` | Downspout | Gutters | GTR DSPW |
| ... | ... | ... | ... |

---

## Implementation Phases

### Phase 1: Document Vault (Week 1-2)
- Database tables: `insurance_scope_documents`, `insurance_scope_document_pages`
- Edge function: `scope-document-ingest` (basic PDF text extraction)
- UI: `ScopeUploader` component
- Storage bucket: `insurance-scopes`

### Phase 2: Structured Extraction (Week 2-3)
- Database tables: `insurance_scope_headers`, `insurance_scope_line_items`
- Edge function: Enhance `scope-document-ingest` with AI table extraction
- UI: Basic scope viewer

### Phase 3: Canonical Mapping (Week 3-4)
- Database tables: `insurance_canonical_items`, `insurance_line_item_mappings`
- Seed canonical items (~150 roofing items)
- Edge function: `scope-line-item-mapper`
- UI: `LineItemMappingReview` component

### Phase 4: Evidence Binding (Week 4-5)
- Database table: `insurance_scope_line_item_evidence`
- Enhance extraction to capture bounding boxes
- UI: `ScopeViewer` with highlighting

### Phase 5: Intelligence Search (Week 5-6)
- Database tables: `insurance_scope_disputes`, `insurance_supplement_packets`
- Edge functions: `scope-evidence-search`, `scope-supplement-packet-generate`
- UI: `DisputeEvidenceBuilder`

### Phase 6: Network Intelligence (Week 6-7)
- Database table: `insurance_network_contributions`
- Materialized view: `insurance_price_statistics`
- Consent UI for data sharing
- Dashboard with cross-company stats

---

## Security & Privacy

### RLS Policies

```sql
-- Documents: tenant isolation
CREATE POLICY "tenant_isolation" ON insurance_scope_documents
  FOR ALL USING (tenant_id = get_user_tenant_id());

-- Network contributions: anonymized, no tenant_id exposed
CREATE POLICY "network_read_all" ON insurance_network_contributions
  FOR SELECT USING (true); -- All authenticated users can read

CREATE POLICY "network_insert_own" ON insurance_network_contributions
  FOR INSERT WITH CHECK (
    contributor_hash = encode(sha256(get_user_tenant_id()::text::bytea), 'hex')
  );
```

### Data Anonymization

- Network contributions use `contributor_hash` (irreversible SHA-256)
- No claim numbers, addresses, or adjuster names in shared data
- Pricing uses buckets, not exact values
- Snippets are redacted to remove PII

---

## Files to Create/Modify

| File | Type | Description |
|------|------|-------------|
| `supabase/migrations/xxx_scope_intelligence_schema.sql` | Migration | All new tables + RLS |
| `supabase/functions/scope-document-ingest/index.ts` | Edge Function | PDF ingestion |
| `supabase/functions/scope-line-item-mapper/index.ts` | Edge Function | Canonical mapping |
| `supabase/functions/scope-evidence-search/index.ts` | Edge Function | Prior examples search |
| `supabase/functions/scope-supplement-packet-generate/index.ts` | Edge Function | Evidence PDF |
| `src/components/insurance/ScopeUploader.tsx` | Component | Upload UI |
| `src/components/insurance/ScopeViewer.tsx` | Component | PDF viewer with highlights |
| `src/components/insurance/LineItemMappingReview.tsx` | Component | Mapping correction UI |
| `src/components/insurance/DisputeEvidenceBuilder.tsx` | Component | Supplement builder |
| `src/components/insurance/ScopeIntelligenceDashboard.tsx` | Component | Analytics |
| `src/hooks/useScopeIntelligence.ts` | Hook | React Query hooks |
| `src/lib/insurance/canonicalItems.ts` | Utility | Seed data + types |
| `src/pages/ScopeIntelligence.tsx` | Page | Main dashboard route |

---

## Success Metrics

| Metric | Target |
|--------|--------|
| PDF extraction accuracy | >95% line items captured |
| Canonical mapping accuracy | >90% auto-mapped correctly |
| Evidence search latency | <500ms for internal, <2s for network |
| User time to generate supplement | <5 minutes (vs 30+ manual) |
| Dispute approval rate improvement | +15% with evidence packets |

---

## Technical Notes

1. **PDF Processing**: Reuse patterns from `roof-report-ingest` for text extraction and page rendering
2. **AI Extraction**: Use Lovable AI (Gemini) for table structure and line item classification
3. **Bounding Boxes**: PDF.js provides text item coordinates; store for highlighting
4. **Storage**: Use existing `documents` bucket with `insurance-scopes/` prefix
5. **Multi-tenant**: All tables follow existing RLS patterns with `get_user_tenant_id()`
6. **Performance**: Materialized view for price stats, refresh daily via cron
