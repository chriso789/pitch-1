

# Scope Intelligence Database Browser with Filtering

## Summary

You have **3 scope documents** in your database, but only **1 has completed parsing**. The "Network" view correctly shows only 1 because it only includes fully-parsed documents with header data. The other 2 are stuck in "extracting" status.

This plan adds a proper database browser with filtering by insurance carrier and state, plus the ability to see and manage document processing status.

---

## Current Data State

| Document | Carrier | Parse Status | Issue |
|----------|---------|--------------|-------|
| State Farm Estimate | State Farm | ✅ Complete | Has header with TX state |
| CHRISTIAN_MORRISSET1... | Unknown | ⏳ Extracting | Stuck in processing |
| Doc - Dec 3 2025... | Unknown | ⏳ Extracting | Stuck in processing |

**Why Network shows 1:** The `scope_network_intelligence` view filters by `parse_status = 'complete'` and requires header data.

---

## Solution: Enhanced Documents Tab with Filters

### New Features

1. **Filter Bar** - Filter documents by:
   - Insurance Carrier (dropdown)
   - State (dropdown) 
   - Parse Status (All / Complete / Processing / Failed)
   - Document Type (Estimate, Supplement, etc.)

2. **Enhanced List View** - Show:
   - Document name and type
   - Carrier and state (from header)
   - Parse status with action buttons
   - RCV/ACV totals when available
   - Created date

3. **Status Management** - Buttons to:
   - Re-process stuck documents
   - View processing errors
   - Delete failed documents

4. **Expandable Details** - Click to see:
   - Full header info (address, pricing totals)
   - Line item preview
   - Processing history

---

## Technical Implementation

### 1. New Component: ScopeDocumentBrowser

Create a dedicated browser component with filtering:

```text
src/components/insurance/ScopeDocumentBrowser.tsx
```

**Features:**
- Filter dropdowns for carrier, state, status
- Data grid with sortable columns
- Inline actions (view, reprocess, delete)
- Pagination for large datasets

### 2. New Hook: useScopeDocumentsWithHeaders

Join documents with headers to get state/carrier data in one query:

```typescript
// Extended query with header data
const { data } = await supabase
  .from('insurance_scope_documents')
  .select(`
    *,
    header:insurance_scope_headers(
      property_state,
      property_city,
      total_rcv,
      total_acv
    )
  `)
  .order('created_at', { ascending: false });
```

### 3. Update ScopeIntelligence Page

Replace simple document list with new browser component:

```typescript
<TabsContent value="documents">
  <ScopeDocumentBrowser 
    onSelectDocument={setSelectedDocumentId}
    viewMode={viewMode}
  />
</TabsContent>
```

---

## UI Design

### Filter Bar Layout

```text
┌─────────────────────────────────────────────────────────────────┐
│ 🔍 Search documents...                                          │
├─────────────────────────────────────────────────────────────────┤
│ [Carrier ▼]  [State ▼]  [Status ▼]  [Type ▼]  [Clear Filters]  │
└─────────────────────────────────────────────────────────────────┘
```

### Document List Row

```text
┌────────────────────────────────────────────────────────────────────────┐
│ 📄 final_draft_with_without_removal...pdf                              │
│    Estimate • State Farm • TX                       ✅ Complete        │
│    RCV: $14,250.75 • ACV: $11,450.25               Feb 2, 2026        │
│                                                    [View] [•••]       │
├────────────────────────────────────────────────────────────────────────┤
│ 📄 CHRISTIAN_MORRISSET1_FINAL_DRAFT...pdf                              │
│    Estimate • Unknown                               ⏳ Extracting      │
│                                                    [Reprocess] [•••]   │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/components/insurance/ScopeDocumentBrowser.tsx` | CREATE | New filterable document browser |
| `src/hooks/useScopeDocumentsWithFilters.ts` | CREATE | Hook for filtered queries with headers |
| `src/pages/ScopeIntelligence.tsx` | MODIFY | Use new browser component in Documents tab |
| `src/components/insurance/ScopeDocumentRow.tsx` | CREATE | Reusable document row component |

---

## Filter Implementation Details

### Carrier Filter
- Populated dynamically from unique `carrier_normalized` values
- Shows display names (State Farm, Allstate, etc.)
- "Unknown" option for documents without carrier detection

### State Filter  
- Populated from `insurance_scope_headers.property_state`
- Standard 2-letter state codes
- Only shows states that exist in your data

### Status Filter
| Value | Description |
|-------|-------------|
| All | Show all documents |
| Complete | Successfully parsed with line items |
| Processing | Currently being extracted |
| Failed | Parse error occurred |
| Needs Review | Parsed but flagged for manual review |

---

## Stuck Documents Solution

For the 2 documents stuck in "extracting" status, I'll add a "Reprocess" button that:

1. Resets `parse_status` to `pending`
2. Calls `scope-document-ingest` edge function again
3. Shows progress toast

This allows you to retry failed extractions without re-uploading.

---

## Expected Result

After implementation:
- **Documents tab** will show a filterable, searchable list
- You can filter by State Farm vs Unknown carrier
- You can filter by TX (or other states once more docs are added)
- Stuck documents can be reprocessed with one click
- Network view will update as more documents complete parsing

