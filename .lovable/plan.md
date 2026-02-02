

# Scope Intelligence: Cross-Tenant Network Aggregation with PII Redaction

## Summary

The Scope Intelligence page currently shows 0 documents because:
1. **No scope documents exist yet** - The `insurance_scope_documents` table is empty across all tenants
2. **RLS restricts to current tenant only** - Even with data, users can only see their own company's documents

This plan implements the cross-tenant "Network Intelligence" feature that aggregates scope data from ALL companies while redacting PII to protect client privacy.

---

## Architecture Overview

### Two Modes of Data Access

| Mode | Description | Data Visible |
|------|-------------|--------------|
| **My Scopes** | Current tenant's documents | Full detail including property address, claim numbers |
| **Network Intelligence** | Aggregated data across ALL tenants | Anonymized - no PII, no tenant identification |

### PII Fields to Redact for Network View

From `insurance_scope_headers`:
- `property_address` → REDACTED
- `property_city` → State only (e.g., "FL")
- `property_zip` → First 3 digits only (e.g., "321**")

From `insurance_scope_documents`:
- `adjuster_name` → REDACTED  
- `claim_number_detected` → REDACTED
- `tenant_id` → EXCLUDED (anonymized contributor hash instead)

---

## Technical Implementation

### 1. Database: Create Network Intelligence View

Create a security-invoker view that aggregates scope data cross-tenant with PII redaction:

```sql
CREATE VIEW scope_network_intelligence
WITH (security_invoker = false) AS
SELECT 
  -- Document metadata (no tenant identifier)
  d.id as document_id,
  md5(d.tenant_id::text) as contributor_hash,
  d.document_type,
  d.carrier_normalized,
  d.format_family,
  d.parse_status,
  EXTRACT(YEAR FROM d.loss_date_detected) as loss_year,
  d.created_at,
  
  -- Header totals (no PII)
  h.total_rcv,
  h.total_acv,
  h.total_depreciation,
  h.deductible,
  h.overhead_amount,
  h.profit_amount,
  
  -- Redacted location (state only)
  h.property_state as state_code,
  LEFT(h.property_zip, 3) as zip_prefix,
  
  -- Price list info
  h.price_list_name,
  h.price_list_region

FROM insurance_scope_documents d
LEFT JOIN insurance_scope_headers h ON h.document_id = d.id
WHERE d.parse_status = 'complete';
```

### 2. Database: RLS Policy for Network View

Allow SELECT for all authenticated users (cross-tenant read-only):

```sql
ALTER TABLE scope_network_intelligence ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_users_can_read_network_intelligence"
  ON scope_network_intelligence FOR SELECT
  USING (auth.role() = 'authenticated');
```

### 3. New Hook: useNetworkIntelligence

Create a new hook that fetches cross-tenant aggregated data:

```typescript
// src/hooks/useNetworkIntelligence.ts

export function useNetworkIntelligenceStats() {
  return useQuery({
    queryKey: ['network-intelligence-stats'],
    queryFn: async () => {
      // Call edge function that uses service role to aggregate
      const { data, error } = await supabase.functions.invoke('scope-network-stats');
      if (error) throw error;
      return data;
    },
  });
}

export function useNetworkIntelligenceDocuments(filters?: NetworkFilters) {
  return useQuery({
    queryKey: ['network-intelligence-documents', filters],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('scope-network-list', {
        body: filters
      });
      if (error) throw error;
      return data.documents;
    },
  });
}
```

### 4. New Edge Function: scope-network-stats

Aggregates stats across all tenants using service role:

```typescript
// supabase/functions/scope-network-stats/index.ts

serve(async (req) => {
  // Use service role to bypass RLS
  const supabase = createClient(url, serviceRoleKey);
  
  // Aggregate stats across all tenants
  const { data: documents } = await supabase
    .from('insurance_scope_documents')
    .select('id, carrier_normalized, parse_status, created_at, loss_date_detected');
  
  // Calculate network-wide stats
  return {
    totalDocuments: documents.length,
    parsedDocuments: documents.filter(d => d.parse_status === 'complete').length,
    carriers: uniqueCarriers,
    monthlyTrend: [...],
    // No PII exposed
  };
});
```

### 5. Update ScopeIntelligence Page

Add toggle between "My Scopes" and "Network Intelligence":

```tsx
// src/pages/ScopeIntelligence.tsx

const [viewMode, setViewMode] = useState<'my-scopes' | 'network'>('my-scopes');

// Conditionally use tenant-scoped or network-wide data
const { data: myDocuments } = useScopeDocuments(); // Current tenant only
const { data: networkStats } = useNetworkIntelligenceStats(); // Cross-tenant

// Show appropriate stats based on mode
const stats = viewMode === 'my-scopes' 
  ? calculateStats(myDocuments)
  : networkStats;
```

### 6. Update ScopeIntelligenceDashboard Component

Add mode toggle and network-specific visualizations:

```tsx
// src/components/insurance/ScopeIntelligenceDashboard.tsx

<Tabs value={viewMode} onValueChange={setViewMode}>
  <TabsList>
    <TabsTrigger value="my-scopes">My Scopes</TabsTrigger>
    <TabsTrigger value="network">
      Network Intelligence
      <Badge variant="secondary" className="ml-2">Beta</Badge>
    </TabsTrigger>
  </TabsList>
</Tabs>

{viewMode === 'network' && (
  <Alert>
    <Shield className="h-4 w-4" />
    <AlertDescription>
      Showing anonymized data from {networkStats.contributorCount} companies. 
      Client and property information is redacted for privacy.
    </AlertDescription>
  </Alert>
)}
```

---

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `supabase/migrations/scope_network_intelligence.sql` | CREATE | View + RLS for cross-tenant access |
| `supabase/functions/scope-network-stats/index.ts` | CREATE | Edge function for network stats |
| `supabase/functions/scope-network-list/index.ts` | CREATE | Edge function for network document list |
| `src/hooks/useNetworkIntelligence.ts` | CREATE | Hooks for network data fetching |
| `src/pages/ScopeIntelligence.tsx` | MODIFY | Add mode toggle, use network data |
| `src/components/insurance/ScopeIntelligenceDashboard.tsx` | MODIFY | Add network view with anonymization notice |

---

## Data Flow Diagram

```text
┌─────────────────────────────────────────────────────────────────────┐
│                         Scope Intelligence UI                        │
├────────────────────────────┬────────────────────────────────────────┤
│       "My Scopes" Tab      │       "Network Intelligence" Tab       │
│   (Tenant-scoped data)     │       (Cross-tenant aggregated)        │
├────────────────────────────┼────────────────────────────────────────┤
│                            │                                        │
│  useScopeDocuments()       │  useNetworkIntelligenceStats()         │
│  → RLS filters by          │  → Edge function (service role)        │
│    current tenant          │  → Returns anonymized aggregates       │
│                            │                                        │
│  Shows:                    │  Shows:                                │
│  - Full property address   │  - State + ZIP prefix only             │
│  - Claim number            │  - No claim numbers                    │
│  - Adjuster name           │  - No adjuster names                   │
│  - All line items          │  - Aggregated pricing stats            │
│                            │  - Carrier distribution                │
│                            │  - No tenant identification            │
└────────────────────────────┴────────────────────────────────────────┘
```

---

## Security Considerations

1. **Service Role Usage**: Network stats edge function uses service role to bypass RLS but ONLY exposes aggregated/anonymized data
2. **No Raw Document Access**: Network view never exposes raw document content or storage paths
3. **Contributor Anonymization**: Tenant IDs are hashed (MD5) so companies can't be identified
4. **Minimum Sample Sizes**: Consider requiring minimum N documents before showing carrier stats (prevents inference attacks)

---

## Empty State Handling

Until companies upload scope documents, the dashboard will show an informative empty state:

```tsx
{stats.totalDocuments === 0 && viewMode === 'network' && (
  <Card className="py-12 text-center">
    <Database className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
    <h3>No network data yet</h3>
    <p className="text-muted-foreground">
      Upload your first insurance scope to contribute to the network intelligence pool.
      All data is anonymized before aggregation.
    </p>
    <Button onClick={() => setActiveTab('upload')}>
      Upload Your First Scope
    </Button>
  </Card>
)}
```

