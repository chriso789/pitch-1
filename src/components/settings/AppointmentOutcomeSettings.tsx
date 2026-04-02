import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Plus, Pencil, Trash2, Target } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useActiveTenantId } from '@/hooks/useActiveTenantId';
import { useToast } from '@/hooks/use-toast';

interface OutcomeType {
  id: string;
  name: string;
  color: string;
  sort_order: number;
  active: boolean;
}

const DEFAULT_COLORS = ['#22c55e', '#f59e0b', '#ef4444', '#6b7280', '#3b82f6', '#8b5cf6', '#ec4899'];

export const AppointmentOutcomeSettings = () => {
  const [outcomes, setOutcomes] = useState<OutcomeType[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<OutcomeType | null>(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState('#3b82f6');
  const { activeTenantId } = useActiveTenantId();
  const { toast } = useToast();

  useEffect(() => {
    if (activeTenantId) fetchOutcomes();
  }, [activeTenantId]);

  const fetchOutcomes = async () => {
    if (!activeTenantId) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('appointment_outcome_types')
      .select('*')
      .eq('tenant_id', activeTenantId)
      .order('sort_order');

    if (!error) setOutcomes(data || []);
    setLoading(false);
  };

  const seedDefaults = async () => {
    if (!activeTenantId) return;
    const defaults = [
      { name: 'Sold', color: '#22c55e', sort_order: 0 },
      { name: 'Follow-up Needed', color: '#f59e0b', sort_order: 1 },
      { name: 'Not Interested', color: '#ef4444', sort_order: 2 },
      { name: 'No Show', color: '#6b7280', sort_order: 3 },
      { name: 'Rescheduled', color: '#3b82f6', sort_order: 4 },
    ];

    const { error } = await supabase
      .from('appointment_outcome_types')
      .insert(defaults.map(d => ({ ...d, tenant_id: activeTenantId })));

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Default outcomes created' });
      fetchOutcomes();
    }
  };

  const openCreate = () => {
    setEditing(null);
    setName('');
    setColor(DEFAULT_COLORS[outcomes.length % DEFAULT_COLORS.length]);
    setDialogOpen(true);
  };

  const openEdit = (o: OutcomeType) => {
    setEditing(o);
    setName(o.name);
    setColor(o.color);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!name.trim() || !activeTenantId) return;

    if (editing) {
      await supabase
        .from('appointment_outcome_types')
        .update({ name: name.trim(), color })
        .eq('id', editing.id);
      toast({ title: 'Outcome updated' });
    } else {
      await supabase
        .from('appointment_outcome_types')
        .insert({ tenant_id: activeTenantId, name: name.trim(), color, sort_order: outcomes.length });
      toast({ title: 'Outcome created' });
    }

    setDialogOpen(false);
    fetchOutcomes();
  };

  const toggleActive = async (o: OutcomeType) => {
    await supabase.from('appointment_outcome_types').update({ active: !o.active }).eq('id', o.id);
    fetchOutcomes();
  };

  const deleteOutcome = async (id: string) => {
    await supabase.from('appointment_outcome_types').delete().eq('id', id);
    toast({ title: 'Outcome deleted' });
    fetchOutcomes();
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Target className="h-5 w-5" />
              Appointment Outcomes
            </CardTitle>
            <CardDescription>
              Define custom, color-coded outcomes to track appointment results
            </CardDescription>
          </div>
          <div className="flex gap-2">
            {outcomes.length === 0 && (
              <Button variant="outline" size="sm" onClick={seedDefaults}>
                Load Defaults
              </Button>
            )}
            <Button size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4 mr-1" /> Add Outcome
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-center py-8 text-muted-foreground">Loading...</div>
        ) : outcomes.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No outcome types defined. Click "Load Defaults" to get started.
          </div>
        ) : (
          <div className="space-y-2">
            {outcomes.map(o => (
              <div key={o.id} className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50">
                <div className="flex items-center gap-3">
                  <div className="w-4 h-4 rounded-full" style={{ backgroundColor: o.color }} />
                  <span className="font-medium">{o.name}</span>
                  {!o.active && <Badge variant="secondary" className="text-[10px] px-1">Inactive</Badge>}
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={o.active} onCheckedChange={() => toggleActive(o)} />
                  <Button variant="ghost" size="icon" onClick={() => openEdit(o)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => deleteOutcome(o.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editing ? 'Edit Outcome' : 'Add Outcome'}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Name</Label>
                <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g., Sold" />
              </div>
              <div>
                <Label>Color</Label>
                <div className="flex items-center gap-3">
                  <input type="color" value={color} onChange={e => setColor(e.target.value)} className="w-10 h-10 rounded border cursor-pointer" />
                  <Input value={color} onChange={e => setColor(e.target.value)} className="w-32" />
                  <div className="flex gap-1">
                    {DEFAULT_COLORS.map(c => (
                      <button
                        key={c}
                        className="w-6 h-6 rounded-full border-2 transition-all"
                        style={{ backgroundColor: c, borderColor: color === c ? 'hsl(var(--primary))' : 'transparent' }}
                        onClick={() => setColor(c)}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleSave} disabled={!name.trim()}>{editing ? 'Update' : 'Create'}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
};
