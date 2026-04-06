import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2 } from 'lucide-react';

interface InventoryReceiveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemId: string | null;
  onSuccess: () => void;
}

export function InventoryReceiveDialog({ open, onOpenChange, itemId, onSuccess }: InventoryReceiveDialogProps) {
  const tenantId = useEffectiveTenantId();
  const [quantity, setQuantity] = useState('1');
  const [locationId, setLocationId] = useState('');
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);

  const { data: locations } = useQuery({
    queryKey: ['inventory-locations', tenantId],
    queryFn: async () => {
      if (!tenantId) return [];
      const { data, error } = await supabase
        .from('inventory_locations')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .order('name');
      if (error) throw error;
      return data || [];
    },
    enabled: !!tenantId,
  });

  const handleReceive = async () => {
    if (!tenantId || !itemId || !locationId || !quantity) return;
    setLoading(true);

    try {
      const qty = parseFloat(quantity);
      const { data: user } = await supabase.auth.getUser();

      // Log transaction
      const { error: txError } = await supabase.from('inventory_transactions').insert({
        tenant_id: tenantId,
        item_id: itemId,
        location_id: locationId,
        transaction_type: 'receive',
        quantity: qty,
        notes: notes || null,
        performed_by: user?.user?.id || null,
      });
      if (txError) throw txError;

      // Upsert inventory level
      const { data: existing } = await supabase
        .from('inventory_levels')
        .select('id, quantity_on_hand')
        .eq('item_id', itemId)
        .eq('location_id', locationId)
        .maybeSingle();

      if (existing) {
        await supabase.from('inventory_levels').update({
          quantity_on_hand: (Number(existing.quantity_on_hand) || 0) + qty,
          last_restocked_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('id', existing.id);
      } else {
        await supabase.from('inventory_levels').insert({
          tenant_id: tenantId,
          item_id: itemId,
          location_id: locationId,
          quantity_on_hand: qty,
          last_restocked_at: new Date().toISOString(),
        });
      }

      setQuantity('1');
      setNotes('');
      onOpenChange(false);
      onSuccess();
    } catch (err) {
      console.error('Receive stock error:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Receive Stock</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Location *</Label>
            <Select value={locationId} onValueChange={setLocationId}>
              <SelectTrigger><SelectValue placeholder="Select storage location" /></SelectTrigger>
              <SelectContent>
                {locations?.map(loc => (
                  <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {locations?.length === 0 && (
              <p className="text-xs text-muted-foreground">No locations yet. Create one in the Locations tab first.</p>
            )}
          </div>
          <div className="space-y-2">
            <Label>Quantity</Label>
            <Input type="number" min="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Notes (optional)</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. PO #12345, Delivery from ABC Supply" />
          </div>
          <Button onClick={handleReceive} disabled={loading || !locationId || !quantity} className="w-full">
            {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Receive {quantity} unit{Number(quantity) !== 1 ? 's' : ''}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
