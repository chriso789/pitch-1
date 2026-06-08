// Per-row supplier match subline shown under each material line item on the
// estimate. Reuses the same SKU columns (abc_item_number / srs_item_code)
// that PushToSupplierDialog writes, so once a match is picked here the
// Push-to-Supplier flow already sees it without any extra mapping.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  AbcCatalogSearchPopover,
  type AbcCatalogItem,
  type AbcLineState,
} from '@/components/orders/AbcCatalogControls';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, DollarSign, Search, AlertCircle, CheckCircle2 } from 'lucide-react';
import { safeText } from '@/lib/safeText';
import {
  abcProductId,
  abcProductText,
  bestCatalogMatch,
  srsProductId,
  srsProductText,
} from '@/components/orders/catalogMatching';

export type SupplierKey = 'abc' | 'srs' | 'qxo';

export interface EstimateLineForMatch {
  id: string;
  item_name: string;
  description?: string | null;
  qty: number;
  unit?: string | null;
  color_specs?: string | null;
  notes?: string | null;
  // SKU mirrors of estimate_line_items columns
  abc_item_number?: string | null;
  abc_color?: string | null;
  abc_uom?: string | null;
  abc_price?: number | null;
  abc_price_status?: string | null;
  abc_price_timestamp?: string | null;
  abc_availability?: string | null;
  srs_item_code?: string | null;
}

interface Props {
  tenantId: string;
  supplier: SupplierKey;
  environment: 'sandbox' | 'production';
  branchCode: string;
  shipToNumber: string;
  item: EstimateLineForMatch;
  // Catalogs are passed down by the parent (loaded once per branch).
  abcCatalog?: AbcCatalogItem[];
  srsCatalog?: any[];
  catalogLoading?: boolean;
  onChange: (patch: Partial<EstimateLineForMatch>) => void;
}

export function InlineSupplierMatch({
  tenantId,
  supplier,
  environment,
  branchCode,
  shipToNumber,
  item,
  abcCatalog,
  srsCatalog,
  catalogLoading,
  onChange,
}: Props) {
  const [pricing, setPricing] = useState(false);

  // Auto-match once when a catalog is available and this row has no SKU.
  const autoTriedRef = useRef<string | null>(null);
  useEffect(() => {
    const key = `${supplier}:${branchCode}:${item.id}`;
    if (autoTriedRef.current === key) return;
    if (supplier === 'abc') {
      if (item.abc_item_number) { autoTriedRef.current = key; return; }
      if (!abcCatalog?.length) return;
      const best = bestCatalogMatch(item, abcCatalog, abcProductText, abcProductId);
      autoTriedRef.current = key;
      if (best && best.score >= 0.72 && !best.ambiguous) {
        const picked = best.product;
        onChange({
          abc_item_number: picked.itemNumber,
          abc_color: picked.color || item.abc_color || null,
          abc_uom: picked.uom || item.abc_uom || item.unit || null,
          color_specs: item.color_specs || picked.color || undefined,
        });
      }
    } else if (supplier === 'srs') {
      if (item.srs_item_code) { autoTriedRef.current = key; return; }
      if (!srsCatalog?.length) return;
      const best = bestCatalogMatch(item, srsCatalog, srsProductText, srsProductId);
      autoTriedRef.current = key;
      if (best && best.score >= 0.72 && !best.ambiguous) {
        onChange({ srs_item_code: String(srsProductId(best.product)) });
      }
    }
  }, [supplier, branchCode, abcCatalog, srsCatalog, item.id, item.abc_item_number, item.srs_item_code]);

  // Lookup matched product details (description) from the loaded catalog.
  const matchedAbc = useMemo<AbcCatalogItem | null>(() => {
    if (supplier !== 'abc' || !item.abc_item_number || !abcCatalog?.length) return null;
    return abcCatalog.find((p) => String(p.itemNumber) === String(item.abc_item_number)) || null;
  }, [supplier, item.abc_item_number, abcCatalog]);

  const matchedSrs = useMemo<any | null>(() => {
    if (supplier !== 'srs' || !item.srs_item_code || !srsCatalog?.length) return null;
    return srsCatalog.find((p) => String(srsProductId(p)) === String(item.srs_item_code)) || null;
  }, [supplier, item.srs_item_code, srsCatalog]);

  const fetchAbcPrice = async () => {
    if (supplier !== 'abc' || !item.abc_item_number || !branchCode || !shipToNumber) return;
    setPricing(true);
    try {
      const { data, error } = await supabase.functions.invoke('abc-api-proxy', {
        body: {
          action: 'price_items',
          tenant_id: tenantId,
          environment,
          branchNumber: branchCode.trim(),
          shipToNumber: shipToNumber.trim(),
          purpose: 'estimating',
          lines: [{
            itemNumber: item.abc_item_number,
            quantity: Math.max(1, Number(item.qty) || 1),
            unitOfMeasure: item.abc_uom || item.unit || 'EA',
          }],
        },
      });
      if (error) throw error;
      if (!data?.success) {
        onChange({
          abc_price: null,
          abc_price_status: 'error',
          abc_price_timestamp: new Date().toISOString(),
        });
        return;
      }
      const body = data.body;
      const lines = Array.isArray(body?.lines) ? body.lines
        : Array.isArray(body) ? body
        : Array.isArray(body?.priceLines) ? body.priceLines : [];
      const first = lines[0] || {};
      const rawPrice = first?.unitPrice?.value ?? first?.unitPrice ?? first?.netPrice ?? first?.price ?? body?.unitPrice;
      const availability = first?.availability?.status ?? first?.availability ?? first?.availabilityStatus ?? null;
      const priceNum = Number(rawPrice);
      if (!Number.isFinite(priceNum)) {
        onChange({
          abc_price: null,
          abc_price_status: 'unavailable',
          abc_availability: typeof availability === 'string' ? availability : null,
          abc_price_timestamp: new Date().toISOString(),
        });
        return;
      }
      onChange({
        abc_price: priceNum,
        abc_price_status: priceNum === 0 ? 'zero' : 'priced',
        abc_availability: typeof availability === 'string' ? availability : null,
        abc_price_timestamp: new Date().toISOString(),
      });
    } catch {
      onChange({
        abc_price: null,
        abc_price_status: 'error',
        abc_price_timestamp: new Date().toISOString(),
      });
    } finally {
      setPricing(false);
    }
  };

  // Auto-fetch price once after the row is matched (only ABC, only if not yet priced).
  const pricedRef = useRef<string | null>(null);
  useEffect(() => {
    if (supplier !== 'abc') return;
    if (!item.abc_item_number || !branchCode || !shipToNumber) return;
    if (item.abc_price_status) return; // already attempted
    const key = `${item.abc_item_number}:${branchCode}:${shipToNumber}`;
    if (pricedRef.current === key) return;
    pricedRef.current = key;
    fetchAbcPrice();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supplier, item.abc_item_number, branchCode, shipToNumber]);

  if (supplier === 'qxo') {
    return (
      <div className="text-[11px] text-muted-foreground italic mt-0.5">
        QXO catalog search coming soon
      </div>
    );
  }

  const sku = supplier === 'abc' ? item.abc_item_number : item.srs_item_code;
  const matchedDesc = supplier === 'abc'
    ? matchedAbc?.itemDescription
    : (matchedSrs?.productName || matchedSrs?.description);
  const matchedColor = supplier === 'abc' ? (matchedAbc?.color || item.abc_color) : null;
  const matchedUom = supplier === 'abc' ? (matchedAbc?.uom || item.abc_uom) : (matchedSrs?.uom);
  const supplierBadge = supplier === 'abc' ? 'ABC' : 'SRS';

  return (
    <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
      {sku ? (
        <>
          <span className="font-mono text-foreground/80">{supplierBadge} #{safeText(sku)}</span>
          {matchedDesc && (
            <span className="truncate max-w-[260px]" title={safeText(matchedDesc)}>· {safeText(matchedDesc)}</span>
          )}
          {matchedColor && <span>· {safeText(matchedColor)}</span>}
          {matchedUom && <span>· {safeText(matchedUom)}</span>}
          {supplier === 'abc' && (
            <PriceBadge
              status={(item.abc_price_status as AbcLineState['abc_price_status']) || null}
              price={item.abc_price ?? null}
              loading={pricing}
              onRefresh={fetchAbcPrice}
              canPrice={!!shipToNumber}
            />
          )}
        </>
      ) : (
        <span className="italic">
          {catalogLoading ? 'Matching to catalog…' : `No ${supplierBadge} match`}
        </span>
      )}
      {supplier === 'abc' && (
        <AbcCatalogSearchPopover
          tenantId={tenantId}
          environment={environment}
          branchNumber={branchCode}
          initialQuery={item.item_name}
          onPick={(picked) => onChange({
            abc_item_number: picked.itemNumber,
            abc_color: picked.color || item.abc_color || null,
            abc_uom: picked.uom || item.abc_uom || item.unit || null,
            color_specs: picked.color || item.color_specs || undefined,
            abc_price: null,
            abc_price_status: null,
            abc_availability: null,
            abc_price_timestamp: null,
          })}
        />
      )}
      {supplier === 'srs' && (
        <SrsSearchInline
          catalog={srsCatalog || []}
          initialQuery={item.item_name}
          onPick={(pid) => onChange({ srs_item_code: pid })}
        />
      )}
    </div>
  );
}

function PriceBadge({
  status,
  price,
  loading,
  onRefresh,
  canPrice,
}: {
  status: AbcLineState['abc_price_status'] | null;
  price: number | null;
  loading: boolean;
  onRefresh: () => void;
  canPrice: boolean;
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-6 px-1.5 text-[11px]"
      onClick={onRefresh}
      disabled={loading || !canPrice}
      title={!canPrice ? 'Set ABC ship-to on the order to fetch live pricing' : 'Refresh ABC price'}
    >
      {loading ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : status === 'priced' ? (
        <span className="flex items-center gap-1 text-emerald-600">
          <CheckCircle2 className="h-3 w-3" />
          ${Number(price || 0).toFixed(2)}
        </span>
      ) : status === 'zero' ? (
        <span className="flex items-center gap-1 text-amber-600">
          <AlertCircle className="h-3 w-3" /> $0.00
        </span>
      ) : status === 'unavailable' ? (
        <span className="flex items-center gap-1">
          <AlertCircle className="h-3 w-3" /> No price
        </span>
      ) : status === 'error' ? (
        <span className="flex items-center gap-1 text-destructive">
          <AlertCircle className="h-3 w-3" /> Retry
        </span>
      ) : (
        <span className="flex items-center gap-1">
          <DollarSign className="h-3 w-3" /> Price
        </span>
      )}
    </Button>
  );
}

// Lightweight SRS catalog search popover. Mirrors the ABC search popover
// look-and-feel but operates on the catalog the parent already loaded.
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
function SrsSearchInline({
  catalog, initialQuery, onPick,
}: { catalog: any[]; initialQuery: string; onPick: (pid: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  useEffect(() => { if (open) setQuery(initialQuery || ''); }, [open, initialQuery]);
  const q = query.trim().toLowerCase();
  const filtered = !q ? catalog.slice(0, 30)
    : catalog.filter((p) => srsProductText(p).toLowerCase().includes(q)).slice(0, 50);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="icon" className="h-6 w-6 shrink-0" title="Search SRS catalog">
          <Search className="h-3 w-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(32rem,calc(100vw-2rem))] p-0" align="start">
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search SRS catalog…"
            className="flex-1 bg-transparent outline-none text-sm"
            autoFocus
          />
        </div>
        <div className="max-h-80 overflow-y-auto">
          {catalog.length === 0 && (
            <div className="p-4 text-xs text-muted-foreground">SRS catalog hasn't loaded yet — set a branch above.</div>
          )}
          {filtered.map((p, i) => {
            const pid = srsProductId(p);
            return (
              <button
                key={`${pid}-${i}`}
                type="button"
                onClick={() => { onPick(String(pid)); setOpen(false); }}
                className="w-full text-left px-3 py-2 text-xs hover:bg-accent flex items-start gap-2 border-b last:border-b-0"
              >
                <span className="font-mono text-muted-foreground shrink-0 w-24 truncate">{pid}</span>
                <span className="flex-1">
                  <span className="block">{p.productName || p.description || '—'}</span>
                  <span className="block text-[10px] text-muted-foreground">
                    {p.option ? `Option: ${p.option}` : ''}{p.uom ? ` · UoM: ${p.uom}` : ''}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
