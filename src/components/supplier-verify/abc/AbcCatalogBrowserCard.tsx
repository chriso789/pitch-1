// Live ABC Product API catalog browser. Renders the actual ABC catalog
// (not the tenant's internal materials) with color-specific children,
// branch availability, valid UOMs, and per-item live pricing pulled from
// `abc-api-proxy` price_items.

import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Search } from 'lucide-react';
import { abcSearchProducts, abcPriceItems, type AbcCatalogSearchResultChild } from '@/lib/abc/proxyClient';
import { toast } from 'sonner';
import { formatCurrency } from '@/lib/utils';

interface Props {
  shipToNumber: string | null;
  branchNumber: string | null;
}

interface PricedRow {
  unitPrice: number | null;
  uom: string | null;
  status: string | null;
  checkedAt: string;
}

export default function AbcCatalogBrowserCard({ shipToNumber, branchNumber }: Props) {
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [children, setChildren] = useState<AbcCatalogSearchResultChild[]>([]);
  const [waf, setWaf] = useState(false);
  const [prices, setPrices] = useState<Record<string, PricedRow>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const runSearch = async () => {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const res = await abcSearchProducts({ query: query.trim(), branchNumber, itemsPerPage: 50 });
      setWaf(res.wafBlocked);
      setChildren(res.children);
      if (!res.success && !res.wafBlocked) {
        toast.error(res.error_code || 'ABC catalog search failed');
      }
    } catch (e: any) {
      toast.error(e?.message || 'ABC catalog search failed');
    } finally {
      setSearching(false);
    }
  };

  const priceOne = async (c: AbcCatalogSearchResultChild) => {
    if (!shipToNumber || !branchNumber) {
      toast.error('Select a ship-to and branch first');
      return;
    }
    const uom = c.defaultUom || c.validUoms[0];
    if (!uom) {
      toast.error('No Product API UOM available for this item');
      return;
    }
    setBusy((b) => ({ ...b, [c.itemNumber]: true }));
    try {
      const res = await abcPriceItems({
        shipToNumber, branchNumber, purpose: 'estimating',
        lines: [{ id: c.itemNumber, itemNumber: c.itemNumber, quantity: 1, uom }],
      });
      const line = res.lines[0];
      setPrices((p) => ({ ...p, [c.itemNumber]: {
        unitPrice: line?.unitPrice ?? null,
        uom: line?.returnedUom ?? uom,
        status: line?.lineStatus ?? (res.wafBlocked ? 'waf_blocked' : (res.errorSummary || null)),
        checkedAt: new Date().toISOString(),
      } }));
    } finally {
      setBusy((b) => ({ ...b, [c.itemNumber]: false }));
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle className="text-base">ABC Catalog Browser</CardTitle>
            <CardDescription>
              Search the live ABC Product API. Each color variant is its own itemNumber. Branch {branchNumber || '—'}.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && runSearch()}
                placeholder="Search ABC catalog (e.g., Landmark, Weathered Wood, ridge cap)…"
                className="pl-9 w-96 h-9"
              />
            </div>
            <Button size="sm" onClick={runSearch} disabled={searching || !query.trim()}>
              {searching ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Search className="h-4 w-4 mr-1" />}
              Search
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {waf && (
          <div className="mb-3 text-xs rounded border border-amber-500/30 bg-amber-500/10 text-amber-800 px-3 py-2">
            ABC's WAF blocked the request. Ask the ABC integration team to allowlist this environment.
          </div>
        )}
        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[140px]">Item #</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="w-[130px]">Color</TableHead>
                <TableHead className="w-[110px]">UOM</TableHead>
                <TableHead className="w-[140px]">Branch avail.</TableHead>
                <TableHead className="w-[160px]">Live Price</TableHead>
                <TableHead className="w-[120px] text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {children.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    {searching ? 'Searching ABC catalog…' : 'Enter a query above to browse the ABC catalog.'}
                  </TableCell>
                </TableRow>
              ) : children.map((c) => {
                const priced = prices[c.itemNumber];
                const branchRow = branchNumber
                  ? c.branchAvailability.find((b) => b.branchNumber === branchNumber)
                  : null;
                return (
                  <TableRow key={c.itemNumber}>
                    <TableCell className="font-mono text-xs">{c.itemNumber}</TableCell>
                    <TableCell>
                      <div className="font-medium">{c.description || '—'}</div>
                      {c.familyName && <div className="text-xs text-muted-foreground">{c.familyName}</div>}
                    </TableCell>
                    <TableCell className="text-xs">{c.colorName || <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-xs">{c.defaultUom || c.validUoms[0] || <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell>
                      {branchRow ? (
                        <Badge variant={branchRow.available ? 'default' : 'destructive'}>
                          {branchRow.available ? 'Available' : 'Not at branch'}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">Unknown</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {priced ? (
                        priced.unitPrice != null ? (
                          <div className="flex flex-col">
                            <span className="font-medium text-emerald-700">{formatCurrency(priced.unitPrice)}</span>
                            <span className="text-[10px] text-muted-foreground">{priced.uom}</span>
                          </div>
                        ) : (
                          <span className="text-xs text-destructive">{priced.status || 'no price'}</span>
                        )
                      ) : (
                        <span className="text-xs text-muted-foreground">Not fetched</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" onClick={() => priceOne(c)} disabled={!!busy[c.itemNumber]}>
                        {busy[c.itemNumber] ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Price'}
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
  );
}
