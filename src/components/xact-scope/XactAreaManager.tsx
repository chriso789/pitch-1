import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from '@/components/ui/use-toast';
import { Plus, Trash2, GripVertical, Loader2 } from 'lucide-react';

interface ScopeArea {
  id: string;
  scope_project_id: string;
  area_name: string;
  area_type: string;
  measurements: Record<string, any>;
  notes: string | null;
  sort_order: number;
}

interface XactAreaManagerProps {
  scopeProjectId: string;
  areas: ScopeArea[];
}

const AREA_TYPES = [
  { value: 'roof', label: 'Roof' },
  { value: 'interior', label: 'Interior' },
  { value: 'exterior', label: 'Exterior' },
  { value: 'gutter', label: 'Gutter' },
  { value: 'siding', label: 'Siding' },
  { value: 'other', label: 'Other' },
];

export const XactAreaManager: React.FC<XactAreaManagerProps> = ({ scopeProjectId, areas }) => {
  const queryClient = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState('');
  const [newType, setNewType] = useState('roof');
  const [newNotes, setNewNotes] = useState('');
  const [adding, setAdding] = useState(false);

  const handleAdd = async () => {
    if (!newName.trim()) return;
    setAdding(true);
    try {
      const { error } = await supabase.from('xact_scope_areas').insert({
        scope_project_id: scopeProjectId,
        area_name: newName.trim(),
        area_type: newType,
        notes: newNotes || null,
        sort_order: areas.length,
      });
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ['xact-scope-areas'] });
      setShowAdd(false);
      setNewName('');
      setNewNotes('');
      toast({ title: 'Area added' });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (areaId: string) => {
    const { error } = await supabase.from('xact_scope_areas').delete().eq('id', areaId);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      queryClient.invalidateQueries({ queryKey: ['xact-scope-areas'] });
      queryClient.invalidateQueries({ queryKey: ['xact-scope-items'] });
      toast({ title: 'Area removed' });
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Define roof sections, rooms, or exterior areas. Line items can be assigned to areas.
        </p>
        <Button size="sm" onClick={() => setShowAdd(true)}>
          <Plus className="h-4 w-4 mr-1" /> Add Area
        </Button>
      </div>

      {!areas.length ? (
        <div className="text-center py-8 text-muted-foreground text-sm">
          No areas defined. Add areas like "Front Slope", "Rear Slope", "Kitchen", etc.
        </div>
      ) : (
        <div className="space-y-2">
          {areas.map(area => (
            <div key={area.id} className="flex items-center gap-3 p-3 border rounded-lg">
              <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab" />
              <div className="flex-1">
                <div className="font-medium text-sm">{area.area_name}</div>
                <div className="text-xs text-muted-foreground capitalize">{area.area_type}</div>
                {area.notes && <div className="text-xs text-muted-foreground mt-1">{area.notes}</div>}
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDelete(area.id)}>
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <Dialog open={showAdd} onOpenChange={setShowAdd}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Area</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Area Name</Label>
              <Input value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Front Slope" />
            </div>
            <div>
              <Label>Type</Label>
              <Select value={newType} onValueChange={setNewType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {AREA_TYPES.map(t => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Notes (optional)</Label>
              <Textarea value={newNotes} onChange={e => setNewNotes(e.target.value)} placeholder="Measurements, damage notes..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button onClick={handleAdd} disabled={!newName.trim() || adding}>
              {adding ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
              Add
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
