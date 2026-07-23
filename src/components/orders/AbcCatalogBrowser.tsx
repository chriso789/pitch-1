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
  uom?: string;
  unitOfMeasure?: string;
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
    const item = String(r.itemNumber || r.item_number || r.sku || '').trim();
    if (!item) continue;
    const rawUnit =
      r.unitPrice ??
      r.unit_price ??
      r.price ??
      r.netPrice ??
      r.net_price ??
      null;
    const rawList =
      r.listPrice ??
      r.list_price ??
      r.suggestedRetailPrice ??
      r.suggested_retail_price ??
      r.retailPrice ??
      r.retail_price ??
      r.msrp ??
      null;
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
      (r.status && typeof r.status === 'object' && r.status.code) || null;
    const statusMessage: string | null =
      (r.status && typeof r.status === 'object' && r.status.message) || null;
    const isErrored =
      statusCode && String(statusCode).toLowerCase() !== 'ok';
    const unit =
      isErrored || rawUnit == null ? null : Number(rawUnit);
    const list = rawList == null ? null : Number(rawList);
    out[item] = {
      unitPrice: unit,
      listPrice: Number.isFinite(list as number) ? (list as number) : null,
      uom: r.uom || r.unitOfMeasure || null,
      currency: String(curStr).toUpperCase().slice(0, 3) || 'USD',
      statusCode,
      statusMessage,
    };
  }
  return out;
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
  const { branches, shipTos } = useAbcCatalog(tenantId, effectiveEnvironment);
  const [searchTerm, setSearchTerm] = useState('shingle');
  const [debounced, setDebounced] = useState('shingle');
  const [items, setItems] = useState<AbcItem[]>([]);
  const [prices, setPrices] = useState<Record<string, AbcPrice>>({});
  const [loading, setLoading] = useState(false);
  const [pricesLoading, setPricesLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [priceError, setPriceError] = useState<string | null>(null);

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
        setItems(normalizeItems(data.body));
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
          unitOfMeasure: it.uom || it.unitOfMeasure || 'EA',
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
        if (!data?.success) {
          throw new Error(
            data?.error_code ||
              data?.body?.message ||
              data?.error ||
              'ABC pricing failed',
          );
        }
        setPrices(normalizePriceRows(data.body));
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
      // Nudge downstream data — the useAbcCatalog hook re-subscribes on tenant change,
      // but a full reload guarantees fresh ship-to/branch rows.
      window.location.reload();
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
              <Badge variant="secondary">
                {loading ? '…' : `${items.length} items`}
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
              onChange={(e) => setSearchTerm(e.target.value)}
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
                  {loading ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
                        Searching ABC catalog...
                      </TableCell>
                    </TableRow>
                  ) : debounced.length < 2 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                        Type at least 2 characters to search the ABC catalog
                      </TableCell>
                    </TableRow>
                  ) : items.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                        No items found for "{debounced}"
                      </TableCell>
                    </TableRow>
                  ) : (
                    items.map((item, idx) => {
                      const p = prices[item.itemNumber];
                      return (
                        <TableRow key={`${item.itemNumber}-${idx}`}>
                          <TableCell className="font-mono text-sm">{item.itemNumber}</TableCell>
                          <TableCell className="font-medium">
                            {item.itemDescription || item.description || '—'}
                          </TableCell>
                          <TableCell>{item.brandName || item.brand || '—'}</TableCell>
                          <TableCell className="text-muted-foreground text-sm">
                            {p?.uom || item.uom || item.unitOfMeasure || '—'}
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
                              <span
                                className="text-xs text-amber-600"
                                title={p.statusMessage}
                              >
                                Call for pricing
                              </span>
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
