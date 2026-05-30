import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Search, DollarSign, AlertCircle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';

export interface AbcCatalogItem {
  itemNumber: string;
  itemDescription: string;
  color?: string | null;
  uom?: string | null;
  raw?: any;
}

export interface AbcLineState {
  abc_item_number?: string | null;
  abc_color?: string | null;
  abc_uom?: string | null;
  abc_price?: number | null;
  abc_price_timestamp?: string | null;
  abc_availability?: string | null;
  abc_price_status?: 'priced' | 'unavailable' | 'zero' | 'error' | null;
  abc_price_error?: string | null;
}

interface PickerProps {
  tenantId: string;
  environment: 'sandbox' | 'production';
  branchNumber: string;
  initialQuery: string;
  onPick: (item: AbcCatalogItem) => void;
}

/**
 * Search popover that calls abc-api-proxy `search_products` scoped to the
 * selected branch. Each result row encodes itemNumber + color (the ABC
 * `option`) + UOM so the caller can persist the full SKU/color/uom triple
 * onto the project material line.
 */
export function AbcCatalogSearchPopover({ tenantId, environment, branchNumber, initialQuery, onPick }: PickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<AbcCatalogItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setQuery(initialQuery || '');
    setError(null);
    window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
  }, [open, initialQuery]);

  const runSearch = async () => {
    if (!query.trim()) return;
    if (!branchNumber.trim()) {
      setError('Select an ABC branch first.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('abc-api-proxy', {
        body: {
          action: 'search_products',
          tenant_id: tenantId,
          environment,
          query: query.trim(),
          branchNumber: branchNumber.trim(),
        },
      });
      if (fnError) throw fnError;
      if (!data?.success) {
        throw new Error(data?.error || `ABC search returned ${data?.status || 'error'}`);
      }
      const body = data.body;
      const raw = Array.isArray(body)
        ? body
        : Array.isArray(body?.items)
          ? body.items
          : Array.isArray(body?.data)
            ? body.data
            : Array.isArray(body?.results)
              ? body.results
              : [];
      const mapped: AbcCatalogItem[] = raw.map((r: any) => ({
        itemNumber: String(r.itemNumber ?? r.item_number ?? r.sku ?? r.productNumber ?? '').trim(),
        itemDescription: String(
          r.itemDescription ?? r.description ?? r.itemDesc ?? r.productName ?? r.name ?? '',
        ).trim(),
        color: r.colorOption ?? r.color ?? r.option ?? r.colorName ?? null,
        uom: r.unitOfMeasure ?? r.uom ?? r.baseUom ?? r.salesUom ?? null,
        raw: r,
      })).filter((r: AbcCatalogItem) => r.itemNumber);
      setResults(mapped);
    } catch (e: any) {
      setError(e?.message || 'ABC search failed');
      setResults([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="h-7 w-7 shrink-0"
          title="Search ABC catalog"
        >
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(32rem,calc(100vw-2rem))] p-0" align="start">
        <div className="flex items-center gap-2 border-b px-3 py-2">
          <Search className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                runSearch();
              }
            }}
            placeholder={`Search ABC branch ${branchNumber || '—'}…`}
            className="flex-1 bg-transparent outline-none text-sm"
          />
          <Button type="button" size="sm" onClick={runSearch} disabled={loading || !query.trim()}>
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Search'}
          </Button>
        </div>
        {error && (
          <div className="border-b px-3 py-2 text-xs text-destructive flex items-center gap-1">
            <AlertCircle className="h-3 w-3" /> {error}
          </div>
        )}
        <div className="max-h-80 overflow-y-auto">
          {!loading && results.length === 0 && !error && (
            <div className="p-4 text-xs text-muted-foreground">
              Enter a keyword (e.g. "ridge cap", "starter") and press Search.
            </div>
          )}
          {results.map((r, i) => (
            <button
              key={`${r.itemNumber}-${r.color || ''}-${i}`}
              type="button"
              onClick={() => {
                onPick(r);
                setOpen(false);
              }}
              className="w-full text-left px-3 py-2 text-xs hover:bg-accent flex items-start gap-2 border-b last:border-b-0"
            >
              <span className="font-mono text-muted-foreground shrink-0 w-24 truncate">{r.itemNumber}</span>
              <span className="flex-1">
                <span className="block">{r.itemDescription || '—'}</span>
                <span className="block text-[10px] text-muted-foreground">
                  {r.color ? `Color: ${r.color}` : 'No color variant'}
                  {r.uom ? ` · UoM: ${r.uom}` : ''}
                </span>
              </span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

interface PriceProps {
  tenantId: string;
  environment: 'sandbox' | 'production';
  branchNumber: string;
  shipToNumber: string;
  itemNumber: string | null | undefined;
  uom: string | null | undefined;
  quantity: number;
  state: AbcLineState;
  onPriced: (next: AbcLineState) => void;
}

/**
 * "Get Price" button for a single line. Calls abc-api-proxy `price_items`
 * with the authenticated ABC user token, the selected branch + ship-to,
 * SKU, quantity and UoM. Differentiates price unavailable vs $0.00 vs
 * integration failure so the UI can show the right badge.
 */
export function AbcPriceButton({
  tenantId,
  environment,
  branchNumber,
  shipToNumber,
  itemNumber,
  uom,
  quantity,
  state,
  onPriced,
}: PriceProps) {
  const [loading, setLoading] = useState(false);

  const disabled =
    loading ||
    !itemNumber ||
    !branchNumber ||
    !shipToNumber ||
    !(quantity > 0);

  const handleClick = async () => {
    if (disabled || !itemNumber) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('abc-api-proxy', {
        body: {
          action: 'price_items',
          tenant_id: tenantId,
          environment,
          branchNumber: branchNumber.trim(),
          shipToNumber: shipToNumber.trim(),
          purpose: 'estimating',
          lines: [{ itemNumber, quantity: Math.max(1, quantity), unitOfMeasure: uom || 'EA' }],
        },
      });
      if (error) throw error;
      if (!data?.success) {
        onPriced({
          ...state,
          abc_price: null,
          abc_price_status: 'error',
          abc_price_error: data?.error || `ABC pricing ${data?.status || 'failed'}`,
          abc_price_timestamp: new Date().toISOString(),
        });
        return;
      }
      const body = data.body;
      const lines = Array.isArray(body?.lines)
        ? body.lines
        : Array.isArray(body)
          ? body
          : Array.isArray(body?.priceLines)
            ? body.priceLines
            : [];
      const first = lines[0] || {};
      const rawPrice =
        first?.unitPrice?.value ??
        first?.unitPrice ??
        first?.netPrice ??
        first?.price ??
        body?.unitPrice;
      const availability =
        first?.availability?.status ??
        first?.availability ??
        first?.availabilityStatus ??
        null;
      const priceNum = Number(rawPrice);
      if (!Number.isFinite(priceNum)) {
        onPriced({
          ...state,
          abc_price: null,
          abc_price_status: 'unavailable',
          abc_availability: typeof availability === 'string' ? availability : null,
          abc_price_timestamp: new Date().toISOString(),
          abc_price_error: 'ABC did not return a price for this item at this branch / ship-to.',
        });
        return;
      }
      onPriced({
        ...state,
        abc_price: priceNum,
        abc_price_status: priceNum === 0 ? 'zero' : 'priced',
        abc_availability: typeof availability === 'string' ? availability : null,
        abc_price_timestamp: new Date().toISOString(),
        abc_price_error: null,
      });
    } catch (e: any) {
      onPriced({
        ...state,
        abc_price: null,
        abc_price_status: 'error',
        abc_price_error: e?.message || 'Price request failed',
        abc_price_timestamp: new Date().toISOString(),
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="h-7 px-2"
      onClick={handleClick}
      disabled={disabled}
      title={
        !itemNumber
          ? 'Pick an ABC item first'
          : !branchNumber
            ? 'Select branch first'
            : !shipToNumber
              ? 'Select ship-to first'
              : 'Get live ABC price'
      }
    >
      {loading ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <DollarSign className="h-3 w-3" />
      )}
    </Button>
  );
}

export function AbcPriceCell({ state }: { state: AbcLineState }) {
  const status = state.abc_price_status;
  if (!status) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  if (status === 'priced') {
    return (
      <span className="text-xs font-medium flex items-center gap-1">
        <CheckCircle2 className="h-3 w-3 text-emerald-600" />
        ${Number(state.abc_price || 0).toFixed(2)}
        {state.abc_availability && (
          <Badge variant="outline" className="ml-1 text-[9px] uppercase">
            {state.abc_availability}
          </Badge>
        )}
      </span>
    );
  }
  if (status === 'zero') {
    return (
      <span className="text-xs text-amber-600 flex items-center gap-1" title="ABC returned $0.00">
        <AlertCircle className="h-3 w-3" /> $0.00
      </span>
    );
  }
  if (status === 'unavailable') {
    return (
      <span className="text-xs text-muted-foreground flex items-center gap-1" title={state.abc_price_error || ''}>
        <AlertCircle className="h-3 w-3" /> No price
      </span>
    );
  }
  return (
    <span className="text-xs text-destructive flex items-center gap-1" title={state.abc_price_error || ''}>
      <AlertCircle className="h-3 w-3" /> Error
    </span>
  );
}
