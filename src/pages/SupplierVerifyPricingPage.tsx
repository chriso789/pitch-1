// Verify Pricing page — per-supplier detail view launched from the
// Supplier Integrations settings card. Shows:
//   1. Recent orders sent to this supplier from the current tenant
//   2. All materials mapped to this supplier + live pricing pulled fresh
//      (scoped to the tenant's selected branch/ship-to for ABC).
// Strictly tenant-scoped via useEffectiveTenantId() + RLS. Never renders
// "$0.00" — falls back to the canonical pending/locked/zero messaging.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { useAbcSetup } from '@/hooks/useAbcSetup';
import { getAbcPrice } from '@/lib/abc/abcApi';
import {
  toSupplierPriceState,
  describeSupplierPriceState,
  type SupplierPriceState,
  type SupplierKind,
} from '@/lib/templates/supplierPricing';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { ArrowLeft, RefreshCcw, Search, Loader2, CheckCircle2, AlertCircle, ExternalLink } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { formatCurrency } from '@/lib/utils';

const SUPPLIER_META: Record<SupplierKind, { label: string; ordersTable: 'abc_orders' | 'srs_orders' | 'qxo_orders'; connectionsTable: 'abc_connections' | 'srs_connections' | 'qxo_connections' }> = {
  abc: { label: 'ABC Supply', ordersTable: 'abc_orders', connectionsTable: 'abc_connections' },
  srs: { label: 'SRS Distribution', ordersTable: 'srs_orders', connectionsTable: 'srs_connections' },
  qxo: { label: 'QXO / Beacon', ordersTable: 'qxo_orders', connectionsTable: 'qxo_connections' },
};

type MaterialRow = {
  id: string;
  code: string;
  name: string;
  uom: string;
  supplier_sku: string | null;
  attributes: Record<string, any> | null;
};

function readMapping(row: MaterialRow, supplier: SupplierKind): { sku: string; uom: string } {
  const attr = row.attributes || {};
  const m = attr.supplier_mappings?.[supplier] || {};
  return {
    sku: m.sku ?? (supplier === 'abc' ? row.supplier_sku ?? '' : ''),
    uom: m.uom ?? '',
  };
}

function orderStatusVariant(status: string | null | undefined): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (!status) return 'outline';
  const s = status.toLowerCase();
  if (['delivered', 'accepted', 'confirmed', 'complete', 'invoiced'].some(k => s.includes(k))) return 'default';
  if (['cancel', 'reject', 'fail', 'error'].some(k => s.includes(k))) return 'destructive';
  if (['queue', 'pending', 'submit', 'process'].some(k => s.includes(k))) return 'secondary';
  return 'outline';
}

function normalizeOrder(supplier: SupplierKind, row: any) {
  if (supplier === 'abc') {
    return {
      id: row.id,
      reference: row.order_number ?? row.confirmation_number ?? '—',
      po: row.purchase_order ?? null,
      status: row.order_status ?? null,
      total: row.total_amount ?? null,
      branch: row.branch_number ?? null,
      when: row.ordered_on ?? row.created_at ?? null,
    };
  }
  if (supplier === 'srs') {
    return {
      id: row.id,
      reference: row.srs_order_id ?? row.order_number ?? '—',
      po: row.order_number ?? null,
      status: row.status ?? null,
      total: row.total_amount ?? null,
      branch: row.branch_id ?? row.branch_number ?? null,
      when: row.submitted_at ?? row.created_at ?? null,
    };
  }
  return {
    id: row.id,
    reference: row.beacon_order_id ?? row.job_number ?? '—',
    po: row.po_number ?? null,
    status: row.status_value ?? row.status_code ?? null,
    total: row.total ?? null,
    branch: row.branch_id ?? null,
    when: row.order_placed_date ?? row.created_at ?? null,
  };
}

export default function SupplierVerifyPricingPage() {
  const navigate = useNavigate();
  const { supplier } = useParams<{ supplier: string }>();
  const tenantId = useEffectiveTenantId();

  const supplierKey = (['abc', 'srs', 'qxo'].includes(supplier ?? '') ? supplier : 'abc') as SupplierKind;
  const meta = SUPPLIER_META[supplierKey];

  const abcSetup = useAbcSetup();

  const [orders, setOrders] = useState<any[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);
  const [materials, setMaterials] = useState<MaterialRow[]>([]);
  const [materialsLoading, setMaterialsLoading] = useState(true);
  const [prices, setPrices] = useState<Record<string, SupplierPriceState>>({});
  const [rowBusy, setRowBusy] = useState<Record<string, boolean>>({});
  const [bulkBusy, setBulkBusy] = useState(false);
  const [query, setQuery] = useState('');

  const loadOrders = useCallback(async () => {
    if (!tenantId) return;
    setOrdersLoading(true);
    const { data, error } = await supabase
      .from(meta.ordersTable)
      .select('*')
      .eq('tenant_id', tenantId)
      .order('updated_at', { ascending: false })
      .limit(100);
    if (error) {
      console.error(`[${supplierKey}] orders fetch`, error);
      toast.error(`Couldn't load orders: ${error.message}`);
    }
    setOrders((data || []).map((r: any) => normalizeOrder(supplierKey, r)));
    setOrdersLoading(false);
  }, [tenantId, meta.ordersTable, supplierKey]);

  const loadMaterials = useCallback(async () => {
    if (!tenantId) return;
    setMaterialsLoading(true);
    const { data, error } = await supabase
      .from('materials' as any)
      .select('id, code, name, uom, supplier_sku, attributes')
      .eq('active', true)
      .order('code');
    if (error) {
      console.error('[materials] fetch', error);
      toast.error(`Couldn't load materials: ${error.message}`);
    }
    // Only rows mapped to this supplier
    const mapped = ((data || []) as unknown as MaterialRow[]).filter((r) => {
      const m = readMapping(r, supplierKey);
      return !!m.sku;
    });
    setMaterials(mapped);
    setMaterialsLoading(false);
  }, [tenantId, supplierKey]);

  useEffect(() => {
    loadOrders();
    loadMaterials();
  }, [loadOrders, loadMaterials]);

  const filteredMaterials = useMemo(() => {
    if (!query) return materials;
    const q = query.toLowerCase();
    return materials.filter((m) =>
      m.name.toLowerCase().includes(q) ||
      m.code.toLowerCase().includes(q) ||
      (m.supplier_sku || '').toLowerCase().includes(q),
    );
  }, [materials, query]);

  const verifyOne = async (row: MaterialRow) => {
    const map = readMapping(row, supplierKey);
    if (!map.sku) return;
    setRowBusy((b) => ({ ...b, [row.id]: true }));
    try {
      let state: SupplierPriceState = { kind: 'pending' };
      if (supplierKey === 'abc') {
        const resp = await getAbcPrice({
          purpose: 'estimating',
          ship_to_number: abcSetup.shipToNumber || undefined,
          branch_number: abcSetup.branchNumber || undefined,
          items: [{ item_number: map.sku, uom: map.uom || undefined }],
        });
        const line = (resp as any)?.data?.items?.[0] ?? (resp as any)?.items?.[0];
        state = toSupplierPriceState({
          unit_price: line?.unit_price ?? null,
          uom: line?.uom ?? map.uom ?? null,
          currency: line?.currency ?? 'USD',
          price_pending: line?.price_pending ?? false,
          reason: line?.reason ?? null,
        });
      } else if (supplierKey === 'srs') {
        const { data, error } = await supabase.functions.invoke('srs-pricing', {
          body: { items: [{ sku: map.sku, uom: map.uom || undefined }] },
        });
        if (error) throw error;
        const line = (data as any)?.items?.[0] ?? (data as any)?.[0] ?? {};
        state = toSupplierPriceState({
          unit_price: line?.unit_price ?? line?.price ?? null,
          uom: line?.uom ?? map.uom ?? null,
          currency: line?.currency ?? 'USD',
          price_pending: line?.price_pending ?? false,
          reason: line?.reason ?? null,
        });
      } else {
        const { data, error } = await supabase.functions.invoke('qxo-pricing', {
          body: { items: [{ sku: map.sku, uom: map.uom || undefined }] },
        });
        if (error) throw error;
        const line = (data as any)?.items?.[0] ?? (data as any)?.[0] ?? {};
        state = toSupplierPriceState({
          unit_price: line?.unit_price ?? line?.price ?? null,
          uom: line?.uom ?? map.uom ?? null,
          currency: line?.currency ?? 'USD',
          price_pending: line?.price_pending ?? false,
          reason: line?.reason ?? null,
        });
      }
      setPrices((p) => ({ ...p, [row.id]: state }));
    } catch (e: any) {
      setPrices((p) => ({ ...p, [row.id]: { kind: 'error', reason: e?.message || 'Lookup failed' } }));
    } finally {
      setRowBusy((b) => ({ ...b, [row.id]: false }));
    }
  };

  const refreshAllPrices = async () => {
    setBulkBusy(true);
    try {
      // Small concurrency to be gentle on suppliers
      const rows = [...filteredMaterials];
      const worker = async () => {
        while (rows.length) {
          const next = rows.shift();
          if (next) await verifyOne(next);
        }
      };
      await Promise.all([worker(), worker(), worker()]);
      toast.success('Live pricing refreshed');
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <div className="container mx-auto max-w-6xl py-6 space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate('/settings?tab=integrations')}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <div>
            <h1 className="text-2xl font-bold">{meta.label} — Verify Pricing</h1>
            <p className="text-sm text-muted-foreground">
              Orders sent from this tenant and live pricing for every material mapped to {meta.label}.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => { loadOrders(); loadMaterials(); }}>
            <RefreshCcw className="h-4 w-4 mr-1" /> Reload
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate('/supplier-orders')}>
            <ExternalLink className="h-4 w-4 mr-1" /> All supplier orders
          </Button>
        </div>
      </div>

      {supplierKey === 'abc' && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Active ABC account</CardTitle>
            <CardDescription>Pricing is pulled against the selected ship-to + branch.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <div className="text-muted-foreground text-xs">Ship-To</div>
              <div className="font-mono">{abcSetup.shipToNumber || '—'}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Branch</div>
              <div className="font-mono">{abcSetup.branchNumber || '—'}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Setup</div>
              <div>{abcSetup.connection?.setup_completed_at ? formatDistanceToNow(new Date(abcSetup.connection.setup_completed_at), { addSuffix: true }) : 'Not completed'}</div>
            </div>
            <div>
              <div className="text-muted-foreground text-xs">Status</div>
              <div>{abcSetup.connection?.connection_status || 'unknown'}</div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Recent orders to {meta.label}</CardTitle>
          <CardDescription>Last 100 orders submitted from this tenant.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Reference</TableHead>
                  <TableHead>PO</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Submitted</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ordersLoading ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Loading orders…</TableCell></TableRow>
                ) : orders.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">No orders sent yet.</TableCell></TableRow>
                ) : orders.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="font-mono text-xs">{o.reference}</TableCell>
                    <TableCell className="font-mono text-xs">{o.po ?? '—'}</TableCell>
                    <TableCell className="font-mono text-xs">{o.branch ?? '—'}</TableCell>
                    <TableCell><Badge variant={orderStatusVariant(o.status)}>{o.status ?? 'unknown'}</Badge></TableCell>
                    <TableCell className="text-right">{o.total != null ? formatCurrency(Number(o.total)) : '—'}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {o.when ? formatDistanceToNow(new Date(o.when), { addSuffix: true }) : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle className="text-base">Items available at this branch</CardTitle>
              <CardDescription>
                Every material mapped to {meta.label}
                {supplierKey === 'abc' && abcSetup.branchNumber ? ` (branch ${abcSetup.branchNumber})` : ''}. Click Verify to pull live pricing.
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search…" className="pl-9 w-64 h-9" />
              </div>
              <Button size="sm" onClick={refreshAllPrices} disabled={bulkBusy || filteredMaterials.length === 0}>
                {bulkBusy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCcw className="h-4 w-4 mr-1" />}
                Refresh all prices
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[120px]">Code</TableHead>
                  <TableHead>Material</TableHead>
                  <TableHead className="w-[160px]">Supplier SKU</TableHead>
                  <TableHead className="w-[80px]">UOM</TableHead>
                  <TableHead className="w-[200px]">Live Price</TableHead>
                  <TableHead className="w-[120px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {materialsLoading ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Loading materials…</TableCell></TableRow>
                ) : filteredMaterials.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    No materials mapped to {meta.label} yet. Map them in Settings → Materials → Supplier Mapping.
                  </TableCell></TableRow>
                ) : filteredMaterials.map((row) => {
                  const map = readMapping(row, supplierKey);
                  const price = prices[row.id];
                  const busy = !!rowBusy[row.id];
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="font-mono text-xs">{row.code}</TableCell>
                      <TableCell><div className="font-medium">{row.name}</div></TableCell>
                      <TableCell className="font-mono text-xs">{map.sku || '—'}</TableCell>
                      <TableCell className="text-xs">{map.uom || row.uom}</TableCell>
                      <TableCell>{price ? <PriceBadge state={price} /> : <span className="text-xs text-muted-foreground">Not fetched</span>}</TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" onClick={() => verifyOne(row)} disabled={busy}>
                          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Verify'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function PriceBadge({ state }: { state: SupplierPriceState }) {
  const label = describeSupplierPriceState(state);
  if (state.kind === 'priced') {
    return (
      <span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-600">
        <CheckCircle2 className="h-3.5 w-3.5" />
        {label}
      </span>
    );
  }
  if (state.kind === 'pending' || state.kind === 'locked' || state.kind === 'unmapped') {
    return <span className="text-xs text-muted-foreground">{label}</span>;
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-amber-600">
      <AlertCircle className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}
