import React, { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Search, Package, Loader2, CheckCircle2, RefreshCw, Download } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { useAbcConnectionStatus } from '@/hooks/useAbcConnectionStatus';
import { useAbcCatalog } from '@/hooks/useAbcCatalog';

/**
 * Live ABC catalog browser — calls the real ABC Product Search endpoint
 * (`product/v1/search/items`) via the `abc-api-proxy` edge function, then
 * batch-fetches contract prices for the visible rows via `price_items`
 * (ABC `/pricing/v2/prices`).
 *
 * Pricing requires `shipToNumber` + `branchNumber`. Production connections
 * must use the tenant's synced ABC ship-to/branch; the sandbox demo fallback
 * is only allowed when the active ABC connection is explicitly sandbox.
 */

interface AbcItem {
  itemNumber: string;
  itemDescription?: string;
  description?: string;
  brandName?: string;
  brand?: string;
  manufacturer?: string;
  manufacturerName?: string;
  uom?: string;
  unitOfMeasure?: string;
  uoms?: Array<string | { code?: string; uom?: string; uomCode?: string; unitOfMeasure?: string; value?: string; isDefault?: boolean; default?: boolean }>;
  category?: string;
  productCategory?: string;
}

interface AbcPrice {
  unitPrice: number | null;
  listPrice: number | null;
  uom: string | null;
  currency: string;
  statusCode?: string | null;
  statusMessage?: string | null;
}

const SANDBOX_SHIP_TO = '2010466-2';
const SANDBOX_BRANCH = '1209';

function normalizeItems(body: any): AbcItem[] {
  if (!body) return [];
  if (Array.isArray(body?.normalized?.items)) {
    return body.normalized.items.map((item: any) => ({
      ...item,
      ...item.raw,
      itemNumber: item.itemNumber,
      itemDescription: item.itemDescription ?? item.raw?.itemDescription ?? item.raw?.description,
      brandName: item.raw?.brandName ?? item.raw?.brand ?? item.raw?.manufacturerName ?? item.raw?.manufacturer,
      uom: item.uoms?.find((u: any) => u?.isDefault)?.code ?? item.uoms?.[0]?.code ?? item.raw?.uom ?? item.raw?.unitOfMeasure,
    }));
  }
  const raw =
    body.items ||
    body.data ||
    body.results ||
    body.searchResults ||
    body?.body?.items ||
    [];
  if (!Array.isArray(raw)) return [];
  return raw as AbcItem[];
}

function readPriceNumber(...values: any[]): number | null {
  for (const value of values) {
    if (value == null) continue;
    const raw = typeof value === 'object' ? value.value ?? value.amount ?? value.price : value;
    const n = Number(raw);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function readItemUom(item: AbcItem): string | null {
  const scalar = item.uom || item.unitOfMeasure || (item as any).unit_of_measure || (item as any).baseUom || (item as any).stockingUom;
  if (typeof scalar === 'string' && scalar.trim()) return scalar.trim().toUpperCase();
  const uoms = item.uoms || (item as any).unitOfMeasures || (item as any).unit_of_measures;
  if (!Array.isArray(uoms) || !uoms.length) return null;
  const preferred: any = uoms.find((u: any) => u?.isDefault || u?.default) || uoms[0];
  if (typeof preferred === 'string') return preferred.trim().toUpperCase() || null;
  const code = preferred?.code || preferred?.uom || preferred?.uomCode || preferred?.unitOfMeasure || preferred?.value;
  return typeof code === 'string' && code.trim() ? code.trim().toUpperCase() : null;
}

function normalizePriceRows(body: any): Record<string, AbcPrice> {
  if (!body) return {};
  const rows =
    body.lines ||
    body.prices ||
    body.items ||
    body.data ||
    body?.body?.lines ||
    [];
  const out: Record<string, AbcPrice> = {};
  if (!Array.isArray(rows)) return out;
  for (const r of rows) {
    const item = String(r.itemNumber || r.item_number || r.returnedItemNumber || r.requestedItemNumber || r.sku || '').trim();
    if (!item) continue;
    const rawUnit = readPriceNumber(
      r.unitPrice,
      r.unit_price,
      r.price,
      r.netPrice,
      r.net_price,
      r.customerPrice,
      r.customer_price,
      r.contractPrice,
      r.contract_price,
    );
    const rawList = readPriceNumber(
      r.listPrice,
      r.list_price,
      r.suggestedRetailPrice,
      r.suggested_retail_price,
      r.retailPrice,
      r.retail_price,
      r.msrp,
    );
    const cur: any = r.currency ?? r.currencyCode ?? r.currency_code;
    const curStr =
      typeof cur === 'string'
        ? cur
        : (cur && typeof cur === 'object' && (cur.code || cur.currency)) || 'USD';
    // ABC returns per-line `status: { code: 'Error'|'Ok', message }`. When
    // Error (e.g. "Cannot price item X. Call for pricing.") ABC sends
    // unitPrice: 0 but often still returns a valid listPrice/MSRP — surface
    // that instead of hiding the number.
    const statusCode: string | null =
      (r.status && typeof r.status === 'object' && r.status.code) || r.lineStatusCode || null;
    const statusMessage: string | null =
      (r.status && typeof r.status === 'object' && r.status.message) || r.lineStatusMessage || null;
    const isErrored =
      statusCode && String(statusCode).toLowerCase() !== 'ok';
    const unit = isErrored || rawUnit == null ? null : rawUnit;
    const list = rawList;
    out[item] = {
      unitPrice: unit,
      listPrice: Number.isFinite(list as number) ? (list as number) : null,
      uom: r.uom || r.unitOfMeasure || r.unit_of_measure || r.returnedUom || r.requestedUom || null,
      currency: String(curStr).toUpperCase().slice(0, 3) || 'USD',
      statusCode,
      statusMessage,
    };
  }
  return out;
}

function extractPriceRows(body: any): any[] {
  if (!body) return [];
  const rows =
    body.lines ||
    body.prices ||
    body.items ||
    body.data ||
    body?.body?.lines ||
    body?.parsed?.lines ||
    [];
  return Array.isArray(rows) ? rows : [];
}

function hasPriceRows(body: any): boolean {
  return extractPriceRows(body).length > 0;
}

function fmtCurrency(value: number, currency: string): string {
  const c = /^[A-Z]{3}$/.test(currency) ? currency : 'USD';
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: c }).format(value);
  } catch {
    return `$${value.toFixed(2)}`;
  }
}

function fmtPrice(p?: AbcPrice): string {
  if (!p) return '—';
  if (p.unitPrice != null && !Number.isNaN(p.unitPrice)) {
    return fmtCurrency(p.unitPrice, p.currency);
  }
  if (p.listPrice != null && !Number.isNaN(p.listPrice)) {
    return fmtCurrency(p.listPrice, p.currency);
  }
  return '—';
}

export const AbcCatalogBrowser: React.FC = () => {
  const tenantId = useEffectiveTenantId();
  const { defaultBranchCode, isConnected, environment } = useAbcConnectionStatus();
  const { toast } = useToast();
  const [syncing, setSyncing] = useState(false);
  const effectiveEnvironment = environment || 'production';
  const { branches, shipTos, refetch: refetchCatalog } = useAbcCatalog(tenantId, effectiveEnvironment);
  const [searchTerm, setSearchTerm] = useState('shingle');
  const [debounced, setDebounced] = useState('shingle');
  const [items, setItems] = useState<AbcItem[]>([]);
  const [prices, setPrices] = useState<Record<string, AbcPrice>>({});
  const [loading, setLoading] = useState(false);
  const [pricesLoading, setPricesLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [priceError, setPriceError] = useState<string | null>(null);
  const [dumping, setDumping] = useState(false);
  const [dumpMode, setDumpMode] = useState(false);
  const [dumpMeta, setDumpMeta] = useState<{ count: number; stoppedReason: string | null } | null>(null);

  const allowSandboxFallback = effectiveEnvironment === 'sandbox';
  // Resolve ship-to / branch (connected account → sandbox fallback only in sandbox).
  const shipToNumber = shipTos[0]?.ship_to_number || (allowSandboxFallback ? SANDBOX_SHIP_TO : '');
  const branchNumber =
    defaultBranchCode || branches[0]?.branch_number || (allowSandboxFallback ? SANDBOX_BRANCH : '');

  useEffect(() => {
    const t = setTimeout(() => setDebounced(searchTerm.trim()), 350);
    return () => clearTimeout(t);
  }, [searchTerm]);

  // Product search.
  useEffect(() => {
    if (!tenantId) return;
    if (debounced.length < 2) {
      setItems([]);
      setPrices({});
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const { data, error: invokeErr } = await supabase.functions.invoke(
          'abc-api-proxy',
          {
            body: {
              action: 'search_products',
              tenant_id: tenantId,
              environment: effectiveEnvironment,
              query: debounced,
              branchNumber: branchNumber || undefined,
            },
          },
        );
        if (cancelled) return;
        if (invokeErr) throw new Error(invokeErr.message || 'ABC search failed');
        if (!data?.success) {
          throw new Error(
            data?.error_code ||
              data?.body?.message ||
              data?.error ||
              'ABC search failed',
          );
        }
        setItems(normalizeItems(data));
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'ABC search failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, debounced, branchNumber, effectiveEnvironment]);

  // Batch price fetch for the visible items.
  useEffect(() => {
    if (!tenantId || !items.length || !shipToNumber || !branchNumber) {
      setPrices({});
      return;
    }
    let cancelled = false;
    setPricesLoading(true);
    setPriceError(null);
    (async () => {
      try {
        const lines = items.slice(0, 25).map((it) => ({
          itemNumber: it.itemNumber,
          quantity: 1,
          unitOfMeasure: readItemUom(it) || undefined,
        }));
        const { data, error: invokeErr } = await supabase.functions.invoke(
          'abc-api-proxy',
          {
            body: {
              action: 'price_items',
              tenant_id: tenantId,
              environment: effectiveEnvironment,
              shipToNumber,
              branchNumber,
              purpose: 'estimating',
              lines,
            },
          },
        );
        if (cancelled) return;
        if (invokeErr) throw new Error(invokeErr.message || 'ABC pricing failed');
        // ABC can return HTTP 200 with a mixed batch: some SKUs priced, some
        // zero/call-for-pricing. The backend correctly marks that run as not
        // fully successful, but the UI must still keep the returned UOM and any
        // priced lines instead of blanking the whole table.
        if (!data?.success && !hasPriceRows(data?.body)) {
          throw new Error(
            data?.error_code ||
              data?.body?.message ||
              data?.error ||
              'ABC pricing failed',
          );
        }
        setPrices(normalizePriceRows(data?.parsed?.lines?.length ? { lines: data.parsed.lines } : data.body));
      } catch (e: any) {
        if (!cancelled) setPriceError(e?.message || 'ABC pricing failed');
      } finally {
        if (!cancelled) setPricesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantId, items, shipToNumber, branchNumber, effectiveEnvironment]);

  const subtitle = useMemo(() => {
    const parts: string[] = [];
    if (branchNumber) parts.push(`Branch ${branchNumber}`);
    if (shipToNumber) parts.push(`Ship-To ${shipToNumber}`);
    parts.push('Live ABC Product + Pricing API');
    return parts.join(' • ');
  }, [branchNumber, shipToNumber]);

  const usingSandboxFallback =
    allowSandboxFallback && shipToNumber === SANDBOX_SHIP_TO && !shipTos.length;

  const needsProductionAccountSync =
    isConnected && effectiveEnvironment === 'production' && (!shipToNumber || !branchNumber);

  const syncAccounts = async () => {
    if (!tenantId) return;
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('abc-api-proxy', {
        body: {
          action: 'sync_accounts',
          tenant_id: tenantId,
          environment: effectiveEnvironment,
        },
      });
      if (error) throw new Error(error.message);
      if (!data?.success) {
        throw new Error(data?.error_code || data?.error || 'sync_accounts failed');
      }
      toast({
        title: 'ABC accounts synced',
        description: `Loaded ${data?.ship_tos_upserted ?? 0} ship-to(s) and ${data?.branches_upserted ?? 0} branch(es). Refreshing pricing…`,
      });
      // Soft-refresh the catalog hook so ship-to/branch rows re-hydrate
      // without a full page reload (which was bouncing users out of the
      // Company Admin tab / modal context).
      refetchCatalog();
    } catch (e: any) {
      toast({
        title: 'ABC account sync failed',
        description: e?.message || 'Could not pull ship-tos from ABC.',
        variant: 'destructive',
      });
    } finally {
      setSyncing(false);
    }
  };

  const dumpEntireCatalog = async () => {
    if (!tenantId) return;
    if (!branchNumber) {
      toast({
        title: 'Branch required',
        description: 'Sync a Ship-To + Branch first so the full branch catalog can be pulled.',
        variant: 'destructive',
      });
      return;
    }
    setDumping(true);
    setError(null);
    setPriceError(null);
    try {
      const { data, error } = await supabase.functions.invoke('abc-api-proxy', {
        body: {
          action: 'dump_catalog',
          tenant_id: tenantId,
          environment: effectiveEnvironment,
          branchNumber,
          shipToNumber: shipToNumber || undefined,
          includePricing: !!shipToNumber,
          maxItems: 5000,
        },
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error_code || data?.error || 'dump_catalog failed');
      const merged: AbcItem[] = Array.isArray(data.items) ? data.items : [];
      setItems(merged);
      // Convert priced rows into the same shape normalizePriceRows produces.
      const priceRows = data.prices && typeof data.prices === 'object' ? Object.values(data.prices) : [];
      setPrices(normalizePriceRows({ lines: priceRows }));
      if (shipToNumber && priceRows.length === 0) {
        setPriceError('ABC returned the catalog but no pricing rows for this ship-to/branch.');
      }
      setDumpMode(true);
      setDumpMeta({ count: merged.length, stoppedReason: data.stoppedReason ?? null });
      toast({
        title: 'Full ABC branch catalog loaded',
        description: `Pulled ${merged.length} unique items from branch ${branchNumber}${
          data.stoppedReason ? ` (stopped: ${data.stoppedReason})` : ''
        }.`,
      });
    } catch (e: any) {
      setError(e?.message || 'Could not dump ABC catalog.');
    } finally {
      setDumping(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Package className="h-5 w-5" />
                ABC Product Catalog
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
            </div>
            <div className="flex items-center gap-2">
              {isConnected && (
                <Badge className="bg-emerald-600 hover:bg-emerald-600 text-white gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Connected{environment ? ` · ${environment}` : ''}
                </Badge>
              )}
              {isConnected && (usingSandboxFallback || needsProductionAccountSync) && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={syncAccounts}
                  disabled={syncing}
                >
                  {syncing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5 mr-1" />
                  )}
                  Sync my ABC accounts
                </Button>
              )}
              {isConnected && branchNumber && (
                <Button
                  size="sm"
                  variant="default"
                  onClick={dumpEntireCatalog}
                  disabled={dumping}
                  title="Pull every item ABC exposes for this branch and price them against the connected ship-to."
                >
                  {dumping ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                  ) : (
                    <Download className="h-3.5 w-3.5 mr-1" />
                  )}
                  Dump entire branch catalog
                </Button>
              )}
              <Badge variant="secondary">
                {loading || dumping ? '…' : `${items.length} items${dumpMode ? ' (full dump)' : ''}`}
              </Badge>
            </div>
          </div>


              {isConnected && usingSandboxFallback && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              You're connected to ABC, but no ship-tos have been pulled for your
              account yet — that's why pricing is quoting against the generic
              sandbox ship-to <span className="font-mono">{SANDBOX_SHIP_TO}</span>{' '}
              (which has no contract for these SKUs, so ABC replies "Call for
              pricing"). Click <b>Sync my ABC accounts</b> to hydrate your real
              ship-to numbers and get live contract pricing.
            </div>
          )}

          {needsProductionAccountSync && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              You're connected to ABC production, but this tenant has not synced a production
              Ship-To and Branch yet. Click <b>Sync my ABC accounts</b> so pricing can use the
              production account instead of the sandbox demo account.
            </div>
          )}

          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search ABC catalog (e.g. shingle, underlayment, drip edge)..."
              value={searchTerm}
              onChange={(e) => { setSearchTerm(e.target.value); if (dumpMode) setDumpMode(false); }}
              className="pl-9"
            />
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {error ? (
          <div className="text-sm text-destructive py-6 text-center">
            {error}
          </div>
        ) : (
          <>
            {priceError && (
              <div className="text-xs text-amber-600 mb-2">
                Pricing unavailable: {priceError}
              </div>
            )}
            {shipToNumber && branchNumber ? (
              <div className="text-xs text-muted-foreground mb-2">
                Prices are quoted against ABC {effectiveEnvironment} ship-to <span className="font-mono">{shipToNumber}</span>{' '}
                on branch <span className="font-mono">{branchNumber}</span>.
              </div>
            ) : (
              <div className="text-xs text-amber-700 mb-2">
                Sync and select a production Ship-To + Branch before pricing can be displayed.
              </div>
            )}
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>ABC Product ID</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Brand</TableHead>
                    <TableHead>UOM</TableHead>
                    <TableHead className="text-right">
                      Price{pricesLoading ? ' …' : ''}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loading || dumping ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
                        {dumping ? `Dumping entire branch ${branchNumber} catalog…` : 'Searching ABC catalog...'}
                      </TableCell>
                    </TableRow>
                  ) : items.length > 0 ? null : dumpMode ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                        No items returned for branch {branchNumber}.
                      </TableCell>
                    </TableRow>
                  ) : debounced.length < 2 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                        Type at least 2 characters to search, or click <b>Dump entire branch catalog</b> to load every item for branch {branchNumber || '—'}.
                      </TableCell>
                    </TableRow>
                  ) : (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                        No items found for "{debounced}"
                      </TableCell>
                    </TableRow>
                  )}
                  {items.length > 0 && (
                    items.map((item, idx) => {
                      const p = prices[item.itemNumber];
                      return (
                        <TableRow key={`${item.itemNumber}-${idx}`}>
                          <TableCell className="font-mono text-sm">{item.itemNumber}</TableCell>
                          <TableCell className="font-medium">
                            {item.itemDescription || item.description || '—'}
                          </TableCell>
                          <TableCell>{item.brandName || item.brand || item.manufacturerName || item.manufacturer || '—'}</TableCell>
                          <TableCell className="text-muted-foreground text-sm">
                            {p?.uom || readItemUom(item) || '—'}
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {pricesLoading && !p ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin inline" />
                            ) : p && p.unitPrice != null ? (
                              fmtPrice(p)
                            ) : p && p.listPrice != null ? (
                              <span
                                className="text-foreground"
                                title={p.statusMessage || 'ABC list price (no contract price on file)'}
                              >
                                {fmtPrice(p)}
                                <span className="ml-1 text-[10px] uppercase text-muted-foreground">
                                  list
                                </span>
                              </span>
                            ) : p && p.statusMessage ? (
                              <span className="text-muted-foreground" title={p.statusMessage}>—</span>
                            ) : (
                              fmtPrice(p)
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};
