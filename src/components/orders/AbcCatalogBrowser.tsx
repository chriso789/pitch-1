import React, { useState } from 'react';
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
import { useAbcCatalogSearch } from '@/lib/abc/useAbcConnection';

/**
 * Live ABC catalog browser — searches the connected tenant's ABC catalog
 * via the abc-api edge function (tenant-scoped, OAuth-backed). Mirrors the
 * SRS catalog browser UX so reps can verify the integration is returning
 * real product data.
 */
export const AbcCatalogBrowser: React.FC = () => {
  const [searchTerm, setSearchTerm] = useState('');
  const [debounced, setDebounced] = useState('');

  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(searchTerm.trim()), 350);
    return () => clearTimeout(t);
  }, [searchTerm]);

  const { data, isFetching, error } = useAbcCatalogSearch(debounced, debounced.length > 1);
  const items = data?.items ?? [];
  const pending = !!data?.pending;

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
              <p className="text-sm text-muted-foreground mt-1">
                Live search against your connected ABC Supply account
              </p>
            </div>
            <Badge variant="secondary">
              {pending ? 'pending' : `${items.length} items`}
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
            {(error as Error).message || 'Failed to load ABC catalog'}
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ABC Product ID</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Color</TableHead>
                  <TableHead>Family</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isFetching ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
                      Searching ABC catalog...
                    </TableCell>
                  </TableRow>
                ) : debounced.length <= 1 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                      Type at least 2 characters to search the ABC catalog
                    </TableCell>
                  </TableRow>
                ) : pending ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                      ABC catalog endpoint is pending — {data?.reason || 'awaiting ABC catalog API enablement'}
                    </TableCell>
                  </TableRow>
                ) : items.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                      No items found
                    </TableCell>
                  </TableRow>
                ) : (
                  items.map((item) => (
                    <TableRow key={item.item_number}>
                      <TableCell className="font-mono text-sm">{item.item_number}</TableCell>
                      <TableCell className="font-medium">{item.description}</TableCell>
                      <TableCell>{item.color_name || '—'}</TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {item.family_id || '—'}
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
