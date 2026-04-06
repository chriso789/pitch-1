import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { History, Loader2 } from 'lucide-react';

const TYPE_COLORS: Record<string, string> = {
  receive: 'bg-green-500/20 text-green-700',
  issue: 'bg-red-500/20 text-red-700',
  transfer_in: 'bg-blue-500/20 text-blue-700',
  transfer_out: 'bg-orange-500/20 text-orange-700',
  adjustment: 'bg-yellow-500/20 text-yellow-700',
  return: 'bg-purple-500/20 text-purple-700',
};

export function InventoryTransactionLog() {
  const tenantId = useEffectiveTenantId();

  const { data: transactions, isLoading } = useQuery({
    queryKey: ['inventory-transactions', tenantId],
    queryFn: async () => {
      if (!tenantId) return [];
      const { data, error } = await supabase
        .from('inventory_transactions')
        .select('*, inventory_items(name, sku), inventory_locations(name)')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return data || [];
    },
    enabled: !!tenantId,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <History className="h-5 w-5" />
          Transaction History
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : transactions?.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <History className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p>No transactions recorded yet</p>
          </div>
        ) : (
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead className="text-right">Qty</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions?.map(tx => (
                  <TableRow key={tx.id}>
                    <TableCell className="whitespace-nowrap text-sm">
                      {new Date(tx.created_at).toLocaleDateString()}{' '}
                      <span className="text-muted-foreground">
                        {new Date(tx.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge className={TYPE_COLORS[tx.transaction_type] || ''} variant="secondary">
                        {tx.transaction_type?.replace('_', ' ')}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div>
                        <span className="font-medium">{(tx as any).inventory_items?.name || '—'}</span>
                        <span className="text-xs text-muted-foreground ml-2">{(tx as any).inventory_items?.sku}</span>
                      </div>
                    </TableCell>
                    <TableCell>{(tx as any).inventory_locations?.name || '—'}</TableCell>
                    <TableCell className="text-right font-mono">
                      {Number(tx.quantity) > 0 ? '+' : ''}{tx.quantity}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                      {tx.notes || '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
