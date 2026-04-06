import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Warehouse, Plus, MapPin, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const LOCATION_TYPES = ['warehouse', 'truck', 'job_site', 'office', 'storage_unit', 'other'];

export function InventoryLocationManager() {
  const tenantId = useEffectiveTenantId();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState('');
  const [locationType, setLocationType] = useState('warehouse');
  const [address, setAddress] = useState('');
  const [saving, setSaving] = useState(false);

  const { data: locations, isLoading } = useQuery({
    queryKey: ['inventory-locations', tenantId],
    queryFn: async () => {
      if (!tenantId) return [];
      const { data, error } = await supabase
        .from('inventory_locations')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('name');
      if (error) throw error;
      return data || [];
    },
    enabled: !!tenantId,
  });

  const handleCreate = async () => {
    if (!tenantId || !name) return;
    setSaving(true);
    try {
      const { error } = await supabase.from('inventory_locations').insert({
        tenant_id: tenantId,
        name,
        location_type: locationType,
        address_line1: address || null,
      });
      if (error) throw error;
      setName('');
      setAddress('');
      setDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: ['inventory-locations'] });
      toast({ title: 'Location created' });
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Warehouse className="h-5 w-5" />
            Storage Locations
          </CardTitle>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <Plus className="h-4 w-4" />
                Add Location
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Storage Location</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Name *</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Main Warehouse" />
                </div>
                <div className="space-y-2">
                  <Label>Type</Label>
                  <Select value={locationType} onValueChange={setLocationType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {LOCATION_TYPES.map(t => (
                        <SelectItem key={t} value={t}>{t.replace('_', ' ')}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Address (optional)</Label>
                  <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Street address" />
                </div>
                <Button onClick={handleCreate} disabled={saving || !name} className="w-full">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Create Location
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : locations?.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Warehouse className="h-12 w-12 mx-auto mb-4 opacity-50" />
            <p className="text-lg font-medium">No storage locations yet</p>
            <p className="text-sm">Add your first warehouse, truck, or job site</p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {locations?.map(loc => (
              <Card key={loc.id} variant="interactive">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <h4 className="font-semibold">{loc.name}</h4>
                      <Badge variant="secondary" className="mt-1">
                        {(loc.location_type || 'other').replace('_', ' ')}
                      </Badge>
                    </div>
                    {loc.is_active ? (
                      <Badge variant="default" className="bg-green-500/20 text-green-700">Active</Badge>
                    ) : (
                      <Badge variant="outline">Inactive</Badge>
                    )}
                  </div>
                  {loc.address_line1 && (
                    <p className="text-sm text-muted-foreground mt-2 flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      {loc.address_line1}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
