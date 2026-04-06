import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Plus, Search, Package, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { InventoryItemForm } from './InventoryItemForm';
import { InventoryReceiveDialog } from './InventoryReceiveDialog';

export function InventoryItemsList() {
  const tenantId = useEffectiveTenantId();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [receiveDialogOpen, setReceiveDialogOpen] = useState(false);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  const { data: items, isLoading } = useQuery({
    queryKey: ['inventory-items', tenantId],
    queryFn: async () => {
      if (!tenantId) return [];
      const { data, error } = await supabase
        .from('inventory_items')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data || [];
    },
    enabled: !!tenantId,
  });

  const { data: levels } = useQuery({
    queryKey: ['inventory-levels', tenantId],
    queryFn: async () => {
      if (!tenantId) return [];
      const { data, error } = await supabase
        .from('inventory_levels')
        .select('*, inventory_locations(name)')
        .eq('tenant_id', tenantId);
      if (error) throw error;
      return data || [];
    },
    enabled: !!tenantId,
  });

  const getItemStock = (itemId: string) => {
    const itemLevels = levels?.filter(l => l.item_id === itemId) || [];
    return itemLevels.reduce((sum, l) => sum + (Number(l.quantity_on_hand) || 0), 0);
  };

  const filteredItems = items?.filter(item =>
    item.name.toLowerCase().includes(search.toLowerCase()) ||
    item.sku.toLowerCase().includes(search.toLowerCase()) ||
    (item.brand && item.brand.toLowerCase().includes(search.toLowerCase())) ||
    (item.barcode && item.barcode.includes(search))
  ) || [];

  const handleReceive = (itemId: string) => {
    setSelectedItemId(itemId);
    setReceiveDialogOpen(true);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <CardTitle className="flex items-center gap-2">
            <Package className="h-5 w-5" />
            Inventory Items
          </CardTitle>
          <div className="flex gap-2">
            <div className="relative flex-1 sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search items, SKU, brand, barcode..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
              <DialogTrigger asChild>
                <Button className="gap-2 shrink-0">
                  <Plus className="h-4 w-4" />
                  Add Item
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>Add Inventory Item</DialogTitle>
                </DialogHeader>
                <InventoryItemForm
                  onSuccess={() => {
                    setAddDialogOpen(false);
                    queryClient.invalidateQueries({ queryKey: ['inventory-items'] });
                    toast({ title: 'Item added to inventory' });
                  }}
                />
              </DialogContent>
            </Dialog>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p className="text-lg font-medium">No inventory items yet</p>
            <p className="text-sm">Add your first item to start tracking inventory</p>
          </div>
        ) : (
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Brand</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Barcode</TableHead>
                  <TableHead className="text-right">Unit Cost</TableHead>
                  <TableHead className="text-right">On Hand</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredItems.map(item => {
                  const stock = getItemStock(item.id);
                  return (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{item.name}</TableCell>
                      <TableCell className="text-muted-foreground">{item.sku}</TableCell>
                      <TableCell>{item.brand || '—'}</TableCell>
                      <TableCell>
                        {item.category ? (
                          <Badge variant="secondary">{item.category}</Badge>
                        ) : '—'}
                      </TableCell>
                      <TableCell className="text-xs font-mono">{item.barcode || '—'}</TableCell>
                      <TableCell className="text-right">
                        {item.unit_cost ? `$${Number(item.unit_cost).toFixed(2)}` : '—'}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant={stock <= 0 ? 'destructive' : stock < 10 ? 'outline' : 'default'}>
                          {stock}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button size="sm" variant="outline" onClick={() => handleReceive(item.id)}>
                          Receive
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        <InventoryReceiveDialog
          open={receiveDialogOpen}
          onOpenChange={setReceiveDialogOpen}
          itemId={selectedItemId}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ['inventory-levels'] });
            queryClient.invalidateQueries({ queryKey: ['inventory-transactions'] });
            toast({ title: 'Stock received successfully' });
          }}
        />
      </CardContent>
    </Card>
  );
}
