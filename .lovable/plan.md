
# Scope Intelligence Enhancement: Network Search & Comparison System

## Overview

This plan enhances the Scope Intelligence system with three major capabilities:

1. **Include ALL insurance documents in the network** - Currently, network stats only show documents from the `insurance_scope_documents` table. We'll ensure all uploaded insurance documents are automatically processed into the scope intelligence pipeline.

2. **Network Line Item Search** - Add the ability to search line items across the entire network database by carrier, category, and description to find approved items as reference.

3. **Scope Comparison Tool** - Allow users to upload a new insurance scope and compare it against the network database to identify missing items that other carriers have paid for similar work.

---

## Phase 1: Ensure All Insurance Documents Feed Network

### Current State
- Documents uploaded to `/insurance` route go into `documents` table with `document_type = 'insurance'`
- Scope documents uploaded via Scope Intelligence go into `insurance_scope_documents` table
- Network view only aggregates from `insurance_scope_documents`

### Solution
Create a database trigger and update the backfill function to automatically process any insurance document into the scope pipeline.

**Database Migration:**
```sql
-- Create trigger to auto-process insurance documents
CREATE OR REPLACE FUNCTION process_insurance_document_to_scope()
RETURNS TRIGGER AS $$
BEGIN
  -- Only trigger for insurance documents with PDF files
  IF NEW.document_type = 'insurance' 
     AND NEW.file_path LIKE '%.pdf' THEN
    
    -- Check if not already processed
    IF NOT EXISTS (
      SELECT 1 FROM insurance_scope_documents 
      WHERE source_document_id = NEW.id
    ) THEN
      -- Insert pending scope document for processing
      INSERT INTO insurance_scope_documents (
        tenant_id,
        source_document_id,
        document_type,
        file_name,
        file_hash,
        file_size_bytes,
        storage_path,
        parse_status,
        created_by
      ) VALUES (
        NEW.tenant_id,
        NEW.id,
        'estimate',
        NEW.filename,
        md5(NEW.file_path),
        NEW.file_size,
        NEW.file_path,
        'pending',
        NEW.uploaded_by
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER auto_process_insurance_docs
  AFTER INSERT ON documents
  FOR EACH ROW
  EXECUTE FUNCTION process_insurance_document_to_scope();
```

---

## Phase 2: Network Line Item Search

### New Edge Function: `scope-network-line-items`

Create an edge function to search line items across the entire network with anonymization:

**File: `supabase/functions/scope-network-line-items/index.ts`**

```typescript
interface LineItemSearchFilters {
  search?: string;           // Text search in description
  carrier_normalized?: string;
  category?: string;
  raw_code?: string;
  unit?: string;
  min_price?: number;
  max_price?: number;
  limit?: number;
  offset?: number;
}

// Returns anonymized line items with price statistics
interface NetworkLineItem {
  id: string;
  raw_code: string;
  raw_description: string;
  raw_category: string;
  unit: string;
  unit_price: number;
  carrier_normalized: string;
  contributor_hash: string;  // Anonymized tenant
  state_code: string;
  frequency: number;         // How often this item appears
}
```

### New Hook: `useNetworkLineItemSearch`

**File: `src/hooks/useNetworkLineItemSearch.ts`**

```typescript
export function useNetworkLineItemSearch(filters: LineItemSearchFilters) {
  return useQuery({
    queryKey: ['network-line-items', filters],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke(
        'scope-network-line-items',
        { body: filters }
      );
      if (error) throw error;
      return data;
    },
    staleTime: 5 * 60 * 1000,
  });
}
```

### New UI Component: `NetworkLineItemBrowser`

**File: `src/components/insurance/NetworkLineItemBrowser.tsx`**

Features:
- Search box with debounced text search
- Carrier dropdown filter (populated from network stats)
- Category dropdown (Roofing, Gutters, Siding, etc.)
- Unit filter (SQ, LF, SF, EA)
- Price range slider
- Results table with:
  - Description
  - Xactimate code
  - Unit price (with min/avg/max across network)
  - Carrier
  - Frequency badge (how often item appears)
- Click to see price statistics modal

---

## Phase 3: Scope Comparison Tool

### Concept

User uploads an insurance scope PDF → System parses it → Compares line items against network database → Shows missing items that other carriers have paid for similar work.

### New Tab: "Compare" in Scope Intelligence

Add a new tab to the Scope Intelligence page for the comparison workflow.

### UI Flow

```text
┌─────────────────────────────────────────────────────────────┐
│  [Upload Scope for Comparison]                              │
│                                                             │
│  Drag & drop an insurance scope PDF to compare              │
│  against the network database                               │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  Processing: Extracting line items...                       │
│  ████████████████░░░░░░░░░░░░░░ 60%                        │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  Comparison Results                                         │
│                                                             │
│  📄 Your Scope: 42 line items | $18,500 RCV                │
│  🌐 Carrier: State Farm | State: FL                        │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ ✅ Matched Items (38)                               │   │
│  │    Items in your scope that match network patterns  │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ ⚠️ Missing Items (15)                 [Add to Supp] │   │
│  │    Items commonly paid by State Farm but not in     │   │
│  │    your scope                                        │   │
│  │                                                     │   │
│  │  • Drip edge - aluminum        $4.25/LF   87% paid │   │
│  │  • Ice & water shield          $3.15/LF   92% paid │   │
│  │  • Roof vent - turbine type   $125/EA    78% paid  │   │
│  │  • Ridge vent - aluminum       $6.50/LF   65% paid │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ 💰 Price Discrepancies (4)                          │   │
│  │    Items where your pricing differs from network    │   │
│  │                                                     │   │
│  │  • Ridge cap: $4.85/LF vs Network avg $5.25/LF     │   │
│  │  • Shingle removal: $54.12/SQ vs Network $58.00/SQ │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  [Download Comparison Report]  [Build Supplement Request]   │
└─────────────────────────────────────────────────────────────┘
```

### New Edge Function: `scope-comparison-analyze`

**File: `supabase/functions/scope-comparison-analyze/index.ts`**

```typescript
interface ComparisonRequest {
  scope_document_id: string;  // ID of the uploaded scope to compare
  carrier_filter?: string;    // Optional: compare against specific carrier
}

interface ComparisonResult {
  scope_summary: {
    total_items: number;
    total_rcv: number;
    carrier_detected: string;
    state_detected: string;
  };
  matched_items: Array<{
    line_item_id: string;
    description: string;
    unit_price: number;
    network_avg_price: number;
    network_frequency: number;
  }>;
  missing_items: Array<{
    canonical_key: string;
    description: string;
    suggested_unit_price: number;
    network_paid_rate: number;  // % of scopes that include this
    network_sample_count: number;
  }>;
  price_discrepancies: Array<{
    line_item_id: string;
    description: string;
    scope_price: number;
    network_avg_price: number;
    difference_percent: number;
  }>;
}
```

### New Components

**`ScopeComparisonUploader.tsx`**
- Drag-and-drop upload zone
- Progress indicator during parsing
- Carrier auto-detection display

**`ScopeComparisonResults.tsx`**
- Three collapsible sections: Matched, Missing, Discrepancies
- Each missing item shows:
  - Description
  - Suggested price (network median)
  - "Add to Supplement" button
- Export comparison as PDF report

**`MissingItemsTable.tsx`**
- Sortable by paid rate, price, frequency
- Bulk select for supplement building
- Filter by category

---

## Files to Create

| File | Purpose |
|------|---------|
| `supabase/functions/scope-network-line-items/index.ts` | Network line item search API |
| `supabase/functions/scope-comparison-analyze/index.ts` | Scope comparison logic |
| `src/hooks/useNetworkLineItemSearch.ts` | React Query hook for line item search |
| `src/hooks/useScopeComparison.ts` | React Query hook for comparison |
| `src/components/insurance/NetworkLineItemBrowser.tsx` | Line item search UI |
| `src/components/insurance/ScopeComparisonUploader.tsx` | Upload UI for comparison |
| `src/components/insurance/ScopeComparisonResults.tsx` | Comparison results display |
| `src/components/insurance/MissingItemsTable.tsx` | Missing items table |

## Files to Modify

| File | Changes |
|------|---------|
| `src/pages/ScopeIntelligence.tsx` | Add "Compare" tab, integrate NetworkLineItemBrowser in Documents tab |
| `src/components/insurance/ScopeDocumentBrowser.tsx` | Add search functionality for line items |
| `src/hooks/useNetworkIntelligence.ts` | Add line item search hook |
| Database migration | Add trigger for auto-processing insurance docs |

---

## Database Views to Create

**Network Line Items View (anonymized):**
```sql
CREATE VIEW scope_network_line_items AS
SELECT 
  li.id,
  li.raw_code,
  li.raw_description,
  li.raw_category,
  li.unit,
  li.unit_price,
  li.total_rcv,
  d.carrier_normalized,
  md5(d.tenant_id::text) as contributor_hash,
  h.property_state as state_code,
  LEFT(h.property_zip, 3) as zip_prefix
FROM insurance_scope_line_items li
JOIN insurance_scope_headers h ON li.header_id = h.id
JOIN insurance_scope_documents d ON h.document_id = d.id
WHERE d.parse_status = 'complete'
  AND li.raw_description IS NOT NULL;
```

---

## Technical Summary

- **Network Inclusion**: Automatic trigger ensures all insurance documents flow into scope processing
- **Line Item Search**: Full-text search across network with carrier/category filters
- **Comparison Engine**: AI-powered matching of uploaded scope against network patterns
- **Missing Item Detection**: Identifies commonly-paid items not in user's scope
- **Price Analysis**: Highlights items priced below network averages
- **Supplement Building**: Direct integration with existing DisputeEvidenceBuilder

---

## Testing Plan

1. Upload an insurance PDF via the Claims page → Verify it appears in Scope Intelligence
2. Search for "ridge cap" in Network Line Items → Verify results from multiple carriers
3. Filter by "State Farm" carrier → Verify only State Farm items shown
4. Upload a scope for comparison → Verify missing items are detected
5. Add missing items to supplement → Verify integration with DisputeEvidenceBuilder
6. Download comparison report → Verify PDF generation
