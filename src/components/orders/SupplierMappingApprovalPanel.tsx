/**
 * Supplier mapping approval console (Phase C).
 *
 * Ingest proposes mappings with approval_state='pending' and mapping_source='api'.
 * Nothing auto-approves — an authorized user reviews the ABC catalog evidence
 * (exact item number, color, UOM, branch, fingerprint) and approves or rejects.
 * Only approved + active mappings are allowed to build a supplier payload.
 */
import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CheckCircle2, XCircle, RefreshCw, ShieldAlert } from 'lucide-react';

type ApprovalState = 'pending' | 'approved' | 'rejected';
type MappingStatus =
  | 'active'
  | 'inactive'
  | 'discontinued'
  | 'superseded'
  | 'revalidation_required'
  | 'stale'
  | 'inactive_supplier_item'
  | 'catalog_conflict';

interface MappingRow {
  id: string;
  supplier: string;
  supplier_item_number: string | null;
  supplier_description: string | null;
  supplier_color_name: string | null;
  supplier_uom: string | null;
  branch_code: string | null;
  mapping_source: string | null;
  approval_state: ApprovalState;
  status: string | null;
  catalog_fingerprint: string | null;
  validated_at: string | null;
  approved_at: string | null;
}

interface Props {
  supplier?: 'abc' | 'srs' | 'qxo';
}

export default function SupplierMappingApprovalPanel({ supplier = 'abc' }: Props) {
  const tenantId = useEffectiveTenantId();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [state, setState] = useState<ApprovalState>('pending');
  const [search, setSearch] = useState('');

  const queryKey = ['supplier-item-mappings', tenantId, supplier, state, search.trim()];

  const { data: rows = [], isLoading, refetch, isFetching } = useQuery({
    queryKey,
    enabled: !!tenantId,
    queryFn: async (): Promise<MappingRow[]> => {
      let query = supabase
        .from('supplier_item_mappings')
        .select(
          'id, supplier, supplier_item_number, supplier_description, supplier_color_name, supplier_uom, branch_code, mapping_source, approval_state, status, catalog_fingerprint, validated_at, approved_at',
        )
        .eq('tenant_id', tenantId as string)
        .eq('supplier', supplier)
        .eq('approval_state', state)
        .order('supplier_description', { ascending: true })
        .limit(2000);
      const q = search.trim();
      if (q) {
        const escaped = q.replace(/[%_]/g, '\\$&');
        query = query.or(
          `supplier_item_number.ilike.%${escaped}%,supplier_description.ilike.%${escaped}%,supplier_color_name.ilike.%${escaped}%,branch_code.ilike.%${escaped}%`,
        );
      }
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as MappingRow[];
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.supplier_item_number, r.supplier_description, r.supplier_color_name, r.branch_code]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [rows, search]);

  const decide = useMutation({
    mutationFn: async ({ ids, next }: { ids: string[]; next: 'approved' | 'rejected' }) => {
      const { data: auth } = await supabase.auth.getUser();
      const { error } = await supabase
        .from('supplier_item_mappings')
        .update({
          approval_state: next,
          approved_by: next === 'approved' ? auth?.user?.id ?? null : null,
          approved_at: next === 'approved' ? new Date().toISOString() : null,
        })
        .in('id', ids)
        .eq('tenant_id', tenantId as string);
      if (error) throw error;
      return ids.length;
    },
    onSuccess: (count, vars) => {
      toast({
        title: vars.next === 'approved' ? 'Mappings approved' : 'Mappings rejected',
        description: `${count} ${supplier.toUpperCase()} mapping${count === 1 ? '' : 's'} moved to ${vars.next}.`,
      });
      queryClient.invalidateQueries({ queryKey: ['supplier-item-mappings'] });
    },
    onError: (e: Error) =>
      toast({ title: 'Update failed', description: e.message, variant: 'destructive' }),
  });

  const missingEvidence = (r: MappingRow) => !r.supplier_item_number || !r.supplier_uom || !r.branch_code;
  const needsRevalidation = (r: MappingRow) =>
    ['revalidation_required', 'stale', 'inactive_supplier_item', 'catalog_conflict'].includes(String(r.status));

  const statusBadge = (status: string | null) => {
    const value = (status || 'active') as MappingStatus;
    if (value === 'active') return <Badge variant="secondary">active</Badge>;
    if (value === 'revalidation_required' || value === 'stale') return <Badge variant="outline">revalidate</Badge>;
    if (value === 'catalog_conflict') return <Badge variant="destructive">catalog conflict</Badge>;
    if (value === 'inactive_supplier_item') return <Badge variant="destructive">inactive item</Badge>;
    return <Badge variant="outline">{value}</Badge>;
  };

  return (
    <Card>
      <CardHeader className="gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">Supplier mapping approvals — {supplier.toUpperCase()}</CardTitle>
            <CardDescription>
              Ingested catalog matches stay unusable until a person approves them. Orders can only be built from
              approved, branch-scoped mappings.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={state} onValueChange={(v) => setState(v as ApprovalState)}>
            <TabsList>
              <TabsTrigger value="pending">Pending</TabsTrigger>
              <TabsTrigger value="approved">Approved</TabsTrigger>
              <TabsTrigger value="rejected">Rejected</TabsTrigger>
            </TabsList>
          </Tabs>
          <Input
            className="h-9 max-w-xs"
            placeholder="Filter by item, color, branch…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {state === 'pending' && filtered.length > 0 && (
            <Button
              size="sm"
              onClick={() => decide.mutate({ ids: filtered.filter((r) => !missingEvidence(r)).map((r) => r.id), next: 'approved' })}
              disabled={decide.isPending}
            >
              <CheckCircle2 className="h-4 w-4 mr-2" />
              Approve all with complete evidence
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Loading mappings…</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            No {state} {supplier.toUpperCase()} mappings matched this view. If the catalog exists, widen the filter or check branch / connection scope before re-ingesting.
          </p>
        ) : (
          <ScrollArea className="h-[420px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Color</TableHead>
                  <TableHead>Item code</TableHead>
                  <TableHead>UOM</TableHead>
                  <TableHead>Branch</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead className="text-right">Decision</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="max-w-[280px]">
                      <div className="truncate font-medium">{r.supplier_description ?? '—'}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        fingerprint {r.catalog_fingerprint?.slice(0, 12) ?? '—'}
                      </div>
                    </TableCell>
                    <TableCell>{r.supplier_color_name ?? <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="font-mono text-xs">{r.supplier_item_number ?? '—'}</TableCell>
                    <TableCell>{r.supplier_uom ?? '—'}</TableCell>
                    <TableCell>{r.branch_code ?? <span className="text-muted-foreground">unscoped</span>}</TableCell>
                    <TableCell className="space-y-1">
                      <Badge variant="secondary">{r.mapping_source ?? 'unknown'}</Badge>
                      <div>{statusBadge(r.status)}</div>
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap">
                      {needsRevalidation(r) ? (
                        <span className="inline-flex items-center text-xs text-muted-foreground">
                          <ShieldAlert className="h-3.5 w-3.5 mr-1" />
                          Review required
                        </span>
                      ) : missingEvidence(r) ? (
                        <span className="inline-flex items-center text-xs text-destructive">
                          <ShieldAlert className="h-3.5 w-3.5 mr-1" />
                          Incomplete evidence
                        </span>
                      ) : state === 'pending' ? (
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => decide.mutate({ ids: [r.id], next: 'approved' })}
                            disabled={decide.isPending}
                          >
                            <CheckCircle2 className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => decide.mutate({ ids: [r.id], next: 'rejected' })}
                            disabled={decide.isPending}
                          >
                            <XCircle className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <Badge variant={state === 'approved' ? 'default' : 'destructive'}>{state}</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
