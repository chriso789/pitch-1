import React, { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { useLocation } from '@/contexts/LocationContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import {
  Plus, Trash2, Save, FileText, Clock, Package, Wrench, CheckCircle, Trophy,
  Search, Archive, ClipboardList, Pencil, GripVertical,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, verticalListSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

// Library of icons users can pick from for stage cards.
const ICON_OPTIONS: Record<string, React.ComponentType<any>> = {
  FileText, Clock, Package, Wrench, CheckCircle, Trophy, Search, Archive, ClipboardList,
};
const COLOR_OPTIONS = [
  { value: 'bg-red-500', label: 'Red' },
  { value: 'bg-orange-500', label: 'Orange' },
  { value: 'bg-yellow-500', label: 'Yellow' },
  { value: 'bg-emerald-500', label: 'Green' },
  { value: 'bg-cyan-500', label: 'Cyan' },
  { value: 'bg-blue-500', label: 'Blue' },
  { value: 'bg-violet-500', label: 'Violet' },
  { value: 'bg-pink-500', label: 'Pink' },
  { value: 'bg-gray-500', label: 'Gray' },
];

const DEFAULT_STAGES = [
  { stage_key: 'submit_documents', name: 'Submit Documents', color: 'bg-red-500', icon: 'FileText' },
  { stage_key: 'permit_processing', name: 'Permit Processing', color: 'bg-orange-500', icon: 'Clock' },
  { stage_key: 'materials_labor', name: 'Materials & Labor', color: 'bg-yellow-500', icon: 'Package' },
  { stage_key: 'in_progress', name: 'In Progress', color: 'bg-blue-500', icon: 'Wrench' },
  { stage_key: 'quality_control', name: 'Quality Control', color: 'bg-violet-500', icon: 'CheckCircle' },
  { stage_key: 'project_complete', name: 'Project Complete', color: 'bg-emerald-500', icon: 'Trophy' },
  { stage_key: 'final_inspection', name: 'Final Inspection', color: 'bg-cyan-500', icon: 'Search' },
  { stage_key: 'closed', name: 'Closed', color: 'bg-gray-500', icon: 'Archive' },
];

type Stage = {
  id: string;
  stage_key: string;
  name: string;
  color: string;
  icon: string;
  sort_order: number;
};

export const ProductionChecklistSettings = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const effectiveTenantId = useEffectiveTenantId();
  const { locations, currentLocationId } = useLocation();
  const [selectedLocationId, setSelectedLocationId] = useState<string>(currentLocationId || '');

  const [addItemOpen, setAddItemOpen] = useState(false);
  const [addItemStage, setAddItemStage] = useState<string>('');
  const [newItemLabel, setNewItemLabel] = useState('');
  const [newItemRequired, setNewItemRequired] = useState(true);
  const [editingItem, setEditingItem] = useState<any | null>(null);

  const [stageDialog, setStageDialog] = useState<null | { mode: 'add' | 'edit'; stage?: Stage }>(null);
  const [stageDraft, setStageDraft] = useState<{ name: string; color: string; icon: string }>({
    name: '', color: 'bg-slate-500', icon: 'ClipboardList',
  });

  useEffect(() => {
    if (currentLocationId && !selectedLocationId) setSelectedLocationId(currentLocationId);
  }, [currentLocationId]);

  // ---------- Stages ----------
  const stagesQuery = useQuery({
    queryKey: ['checklist-stages', effectiveTenantId, selectedLocationId || 'company'],
    queryFn: async () => {
      let q = supabase
        .from('production_checklist_stages' as any)
        .select('*')
        .eq('tenant_id', effectiveTenantId!)
        .order('sort_order');
      q = selectedLocationId ? q.eq('location_id', selectedLocationId) : q.is('location_id', null);
      const { data, error } = await q;
      if (error) throw error;
      let stages = (data || []) as unknown as Stage[];

      // Lazy-seed defaults the first time this scope has no stages
      if (stages.length === 0 && effectiveTenantId) {
        const rows = DEFAULT_STAGES.map((s, i) => ({
          tenant_id: effectiveTenantId,
          location_id: selectedLocationId || null,
          stage_key: s.stage_key,
          name: s.name,
          color: s.color,
          icon: s.icon,
          sort_order: i,
        }));
        const { data: inserted } = await supabase
          .from('production_checklist_stages' as any)
          .insert(rows)
          .select('*');
        stages = (inserted || []) as unknown as Stage[];
      }
      return stages.sort((a, b) => a.sort_order - b.sort_order);
    },
    enabled: !!effectiveTenantId,
  });

  const stages = stagesQuery.data || [];

  const reorderStages = useMutation({
    mutationFn: async (next: Stage[]) => {
      await Promise.all(next.map((s, i) =>
        supabase.from('production_checklist_stages' as any).update({ sort_order: i }).eq('id', s.id)
      ));
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['checklist-stages'] }),
  });

  const saveStage = useMutation({
    mutationFn: async () => {
      if (stageDialog?.mode === 'add') {
        const stage_key = stageDraft.name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
          + '_' + Math.random().toString(36).slice(2, 6);
        await supabase.from('production_checklist_stages' as any).insert({
          tenant_id: effectiveTenantId,
          location_id: selectedLocationId || null,
          stage_key,
          name: stageDraft.name.trim(),
          color: stageDraft.color,
          icon: stageDraft.icon,
          sort_order: stages.length,
        });
      } else if (stageDialog?.mode === 'edit' && stageDialog.stage) {
        await supabase.from('production_checklist_stages' as any).update({
          name: stageDraft.name.trim(),
          color: stageDraft.color,
          icon: stageDraft.icon,
          updated_at: new Date().toISOString(),
        }).eq('id', stageDialog.stage.id);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['checklist-stages'] });
      setStageDialog(null);
      toast({ title: 'Stage saved' });
    },
  });

  const deleteStage = useMutation({
    mutationFn: async (stage: Stage) => {
      // Remove items in this stage (only for this location scope) then the stage itself.
      let itemsQ = supabase.from('production_checklist_templates').delete()
        .eq('tenant_id', effectiveTenantId!).eq('stage_key', stage.stage_key);
      itemsQ = selectedLocationId ? itemsQ.eq('location_id', selectedLocationId) : itemsQ.is('location_id', null);
      await itemsQ;
      await supabase.from('production_checklist_stages' as any).delete().eq('id', stage.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['checklist-stages'] });
      queryClient.invalidateQueries({ queryKey: ['checklist-templates'] });
      toast({ title: 'Stage removed' });
    },
  });

  // ---------- Items ----------
  const { data: templates = [] } = useQuery({
    queryKey: ['checklist-templates', effectiveTenantId, selectedLocationId || 'company'],
    queryFn: async () => {
      let query = supabase
        .from('production_checklist_templates')
        .select('*')
        .eq('tenant_id', effectiveTenantId!)
        .order('sort_order');
      query = selectedLocationId ? query.eq('location_id', selectedLocationId) : query.is('location_id', null);
      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    },
    enabled: !!effectiveTenantId,
  });

  const addItem = useMutation({
    mutationFn: async () => {
      if (!effectiveTenantId || !newItemLabel.trim() || !addItemStage) return;
      const { data: { user } } = await supabase.auth.getUser();
      const maxSort = templates.filter(t => t.stage_key === addItemStage)
        .reduce((m, t) => Math.max(m, t.sort_order || 0), 0);
      await supabase.from('production_checklist_templates').insert({
        tenant_id: effectiveTenantId,
        location_id: selectedLocationId || null,
        stage_key: addItemStage,
        item_label: newItemLabel.trim(),
        is_required: newItemRequired,
        sort_order: maxSort + 1,
        created_by: user?.id,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['checklist-templates'] });
      setNewItemLabel(''); setAddItemOpen(false);
      toast({ title: 'Checklist item added' });
    },
  });

  const updateItem = useMutation({
    mutationFn: async (item: any) => {
      await supabase.from('production_checklist_templates').update({
        item_label: (item.item_label || '').trim(),
        is_required: !!item.is_required,
        updated_at: new Date().toISOString(),
      }).eq('id', item.id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['checklist-templates'] });
      setEditingItem(null);
      toast({ title: 'Checklist item updated' });
    },
  });

  const deleteItem = useMutation({
    mutationFn: async (id: string) => {
      await supabase.from('production_checklist_templates').delete().eq('id', id);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['checklist-templates'] });
      toast({ title: 'Checklist item removed' });
    },
  });

  // ---------- DnD ----------
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIdx = stages.findIndex(s => s.id === active.id);
    const newIdx = stages.findIndex(s => s.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const next = arrayMove(stages, oldIdx, newIdx);
    queryClient.setQueryData(
      ['checklist-stages', effectiveTenantId, selectedLocationId || 'company'],
      next.map((s, i) => ({ ...s, sort_order: i })),
    );
    reorderStages.mutate(next);
  };

  if (stagesQuery.isLoading) {
    return <div className="text-center py-8 text-muted-foreground">Loading checklist stages…</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <ClipboardList className="h-6 w-6" />
            Pre-Build Checklist
          </h2>
          <p className="text-muted-foreground text-sm">
            Each stage is a checkbox. Completion dates are recorded automatically when checked off on the project.
            Drag stages by the handle to reorder. Use the pencil to rename or pick a new icon, the trash to delete.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium text-muted-foreground">Editing checklist for</label>
          <Select value={selectedLocationId || '__company__'} onValueChange={(v) => setSelectedLocationId(v === '__company__' ? '' : v)}>
            <SelectTrigger className="w-[240px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__company__">Company default (all locations)</SelectItem>
              {locations.map(loc => (
                <SelectItem key={loc.id} value={loc.id}>{loc.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button size="sm" onClick={() => {
          setStageDraft({ name: '', color: 'bg-slate-500', icon: 'ClipboardList' });
          setStageDialog({ mode: 'add' });
        }}>
          <Plus className="h-4 w-4 mr-1" /> Add Stage
        </Button>
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={stages.map(s => s.id)} strategy={verticalListSortingStrategy}>
          {stages.map(stage => {
            const stageTemplates = templates.filter(t => t.stage_key === stage.stage_key);
            return (
              <SortableStageCard
                key={stage.id}
                stage={stage}
                templates={stageTemplates}
                onAddItem={() => { setAddItemStage(stage.stage_key); setNewItemLabel(''); setNewItemRequired(true); setAddItemOpen(true); }}
                onEditStage={() => { setStageDraft({ name: stage.name, color: stage.color, icon: stage.icon }); setStageDialog({ mode: 'edit', stage }); }}
                onDeleteStage={() => {
                  if (confirm(`Delete the "${stage.name}" stage and all its items?`)) deleteStage.mutate(stage);
                }}
                onEditItem={(t) => setEditingItem({ ...t })}
                onDeleteItem={(id) => deleteItem.mutate(id)}
              />
            );
          })}
        </SortableContext>
      </DndContext>

      {/* Add/Edit stage dialog */}
      <Dialog open={!!stageDialog} onOpenChange={(o) => !o && setStageDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{stageDialog?.mode === 'add' ? 'Add Stage' : 'Rename Stage'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="text-sm font-medium">Stage Name</label>
              <Input value={stageDraft.name} onChange={(e) => setStageDraft({ ...stageDraft, name: e.target.value })} placeholder="e.g., Submit Documents" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium">Icon</label>
                <Select value={stageDraft.icon} onValueChange={(v) => setStageDraft({ ...stageDraft, icon: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.keys(ICON_OPTIONS).map(name => {
                      const I = ICON_OPTIONS[name];
                      return <SelectItem key={name} value={name}><span className="flex items-center gap-2"><I className="h-4 w-4" />{name}</span></SelectItem>;
                    })}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium">Color</label>
                <Select value={stageDraft.color} onValueChange={(v) => setStageDraft({ ...stageDraft, color: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {COLOR_OPTIONS.map(c => (
                      <SelectItem key={c.value} value={c.value}>
                        <span className="flex items-center gap-2"><span className={cn('w-4 h-4 rounded-full', c.value)} />{c.label}</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => saveStage.mutate()} disabled={!stageDraft.name.trim()}>
              <Save className="h-4 w-4 mr-1" /> Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add item dialog */}
      <Dialog open={addItemOpen} onOpenChange={setAddItemOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add Checklist Item</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="text-sm font-medium">Item Label</label>
              <Input value={newItemLabel} onChange={(e) => setNewItemLabel(e.target.value)} placeholder="e.g., Permit submitted" />
            </div>
            <div className="flex items-center gap-2">
              <Checkbox checked={newItemRequired} onCheckedChange={(c) => setNewItemRequired(!!c)} />
              <label className="text-sm">Required to advance stage</label>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => addItem.mutate()} disabled={!newItemLabel.trim()}>
              <Save className="h-4 w-4 mr-1" /> Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit item dialog */}
      <Dialog open={!!editingItem} onOpenChange={(o) => !o && setEditingItem(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Checklist Item</DialogTitle></DialogHeader>
          {editingItem && (
            <div className="space-y-4 py-4">
              <div>
                <label className="text-sm font-medium">Item Label</label>
                <Input value={editingItem.item_label || ''} onChange={(e) => setEditingItem({ ...editingItem, item_label: e.target.value })} />
              </div>
              <div className="flex items-center gap-2">
                <Checkbox checked={!!editingItem.is_required} onCheckedChange={(c) => setEditingItem({ ...editingItem, is_required: !!c })} />
                <label className="text-sm">Required to advance stage</label>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => editingItem && updateItem.mutate(editingItem)} disabled={!editingItem?.item_label?.trim()}>
              <Save className="h-4 w-4 mr-1" /> Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

function SortableStageCard({
  stage, templates, onAddItem, onEditStage, onDeleteStage, onEditItem, onDeleteItem,
}: {
  stage: Stage;
  templates: any[];
  onAddItem: () => void;
  onEditStage: () => void;
  onDeleteStage: () => void;
  onEditItem: (t: any) => void;
  onDeleteItem: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: stage.id });
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  const Icon = ICON_OPTIONS[stage.icon] || ClipboardList;

  return (
    <div ref={setNodeRef} style={style}>
      <Card>
        <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <button
              type="button"
              className="p-1 -ml-1 cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground touch-none"
              aria-label="Drag to reorder"
              {...attributes}
              {...listeners}
            >
              <GripVertical className="h-4 w-4" />
            </button>
            <CardTitle className="flex items-center gap-2 text-sm min-w-0">
              <div className={cn('w-5 h-5 rounded-full flex items-center justify-center shrink-0', stage.color)}>
                <Icon className="h-3 w-3 text-white" />
              </div>
              <span className="truncate">{stage.name}</span>
              <Badge variant="secondary" className="text-[10px] shrink-0">{templates.length} items</Badge>
            </CardTitle>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Button size="sm" variant="outline" onClick={onAddItem}>
              <Plus className="h-3 w-3 mr-1" /> Add Item
            </Button>
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onEditStage} aria-label="Rename stage">
              <Pencil className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" className="h-8 w-8 text-destructive hover:text-destructive" onClick={onDeleteStage} aria-label="Delete stage">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {templates.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">No items configured for this stage.</p>
          ) : (
            <div className="space-y-1">
              {templates.map((template) => (
                <div key={template.id} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/50">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="text-sm truncate">{template.item_label}</span>
                    {template.is_required && (
                      <Badge variant="destructive" className="text-[9px] px-1 py-0 shrink-0">Required</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onEditItem(template)}>
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive hover:text-destructive" onClick={() => onDeleteItem(template.id)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
