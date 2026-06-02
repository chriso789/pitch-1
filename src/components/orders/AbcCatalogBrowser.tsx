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
import { Search, Package, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { useAbcConnectionStatus } from '@/hooks/useAbcConnectionStatus';

/**
 * Live ABC catalog browser — calls the real ABC Product Search endpoint
 * (`product/v1/search/items`) via the `abc-api-proxy` edge function.
 *
 * We deliberately bypass the stubbed `abc-api` `/catalog/search` route
 * (which always returns `pending: catalog_not_synced`) because ABC does
 * not provide a bulk catalog dump — items must be searched on demand.
 *
 * Mirrors the SRS catalog UX so reps know the integration is live.
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

function normalizeItems(body: any): AbcItem[] {
  if (!body) return [];
  // ABC has returned items under a few different keys depending on env.
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

export const AbcCatalogBrowser: React.FC = () => {
  const tenantId = useEffectiveTenantId();
  const { defaultBranchCode, isConnected } = useAbcConnectionStatus();
  const [searchTerm, setSearchTerm] = useState('shingle');
  const [debounced, setDebounced] = useState('shingle');
  const [items, setItems] = useState<AbcItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(searchTerm.trim()), 350);
    return () => clearTimeout(t);
  }, [searchTerm]);

  useEffect(() => {
    if (!tenantId) return;
    if (debounced.length < 2) {
      setItems([]);
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
              query: debounced,
              branchNumber: defaultBranchCode || undefined,
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
  }, [tenantId, isConnected, debounced, defaultBranchCode]);

  const subtitle = useMemo(() => {
    const parts: string[] = [];
    if (defaultBranchCode) parts.push(`Branch ${defaultBranchCode}`);
    parts.push('Live ABC Supply Product API');
    return parts.join(' • ');
  }, [defaultBranchCode]);

  return (
    <Card>
      <CardHeader>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Package className="h-5 w-5" />
                ABC Product Catalog
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>
            </div>
            <Badge variant="secondary">
              {loading ? '…' : `${items.length} items`}
            </Badge>
          </div>

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
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ABC Product ID</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Brand</TableHead>
                  <TableHead>UOM</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
                      Searching ABC catalog...
                    </TableCell>
                  </TableRow>
                ) : debounced.length < 2 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                      Type at least 2 characters to search the ABC catalog
                    </TableCell>
                  </TableRow>
                ) : items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                      No items found for "{debounced}"
                    </TableCell>
                  </TableRow>
                ) : (
                  items.map((item, idx) => (
                    <TableRow key={`${item.itemNumber}-${idx}`}>
                      <TableCell className="font-mono text-sm">{item.itemNumber}</TableCell>
                      <TableCell className="font-medium">
                        {item.itemDescription || item.description || '—'}
                      </TableCell>
                      <TableCell>{item.brandName || item.brand || '—'}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {item.uom || item.unitOfMeasure || '—'}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
