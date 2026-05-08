import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import { Plus, Trash2, Save, FileText, Clock, Package, Wrench, CheckCircle, Trophy, Search, Archive, ClipboardList } from 'lucide-react';
import { cn } from '@/lib/utils';

const STAGE_CONFIG = [
  { key: 'submit_documents', name: 'Submit Documents', color: 'bg-red-500', icon: FileText },
  { key: 'permit_processing', name: 'Permit Processing', color: 'bg-orange-500', icon: Clock },
  { key: 'materials_labor', name: 'Materials & Labor', color: 'bg-yellow-500', icon: Package },
  { key: 'in_progress', name: 'In Progress', color: 'bg-blue-500', icon: Wrench },
  { key: 'quality_control', name: 'Quality Control', color: 'bg-violet-500', icon: CheckCircle },
  { key: 'project_complete', name: 'Project Complete', color: 'bg-emerald-500', icon: Trophy },
  { key: 'final_inspection', name: 'Final Inspection', color: 'bg-cyan-500', icon: Search },
  { key: 'closed', name: 'Closed', color: 'bg-gray-500', icon: Archive },
];

export const ProductionChecklistSettings = () => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const effectiveTenantId = useEffectiveTenantId();
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [newItemLabel, setNewItemLabel] = useState('');
  const [newItemDescription, setNewItemDescription] = useState('');
  const [newItemStage, setNewItemStage] = useState('submit_documents');
  const [newItemRequired, setNewItemRequired] = useState(true);
  const [newItemTradeType, setNewItemTradeType] = useState('');

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ['checklist-templates', effectiveTenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('production_checklist_templates')
        .select('*')
        .eq('tenant_id', effectiveTenantId!)
        .order('sort_order');
      if (error) throw error;
      return data || [];
    },
    enabled: !!effectiveTenantId,
  });

  const addMutation = useMutation({
    mutationFn: async () => {
      if (!effectiveTenantId || !newItemLabel.trim()) return;
      const { data: { user } } = await supabase.auth.getUser();
      const maxSort = templates
        .filter(t => t.stage_key === newItemStage)
        .reduce((max, t) => Math.max(max, t.sort_order || 0), 0);

      await supabase.from('production_checklist_templates').insert({
        tenant_id: effectiveTenantId,
        stage_key: newItemStage,
        item_label: newItemLabel.trim(),
        item_description: newItemDescription.trim() || null,
        is_required: newItemRequired,
        sort_order: maxSort + 1,
        trade_type: newItemTradeType || null,
        created_by: user?.id,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['checklist-templates'] });
      setNewItemLabel('');
      setNewItemDescription('');
      setNewItemTradeType('');
      setAddDialogOpen(false);
      toast({ title: 'Checklist item added' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (templateId: string) => {
      await supabase.from('production_checklist_templates').delete().eq('id', templateId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['checklist-templates'] });
      toast({ title: 'Checklist item removed' });
    },
  });

  if (isLoading) {
    return <div className="text-center py-8 text-muted-foreground">Loading checklist templates...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <ClipboardList className="h-6 w-6" />
            Pre-Build Checklist
          </h2>
          <p className="text-muted-foreground text-sm">
            Configure checklist items for each production stage. These apply to all projects company-wide.
          </p>
        </div>
        <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1" /> Add Checklist Item
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Checklist Item</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <label className="text-sm font-medium">Production Stage</label>
                <Select value={newItemStage} onValueChange={setNewItemStage}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STAGE_CONFIG.map(s => (
                      <SelectItem key={s.key} value={s.key}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium">Item Label</label>
                <Input
                  value={newItemLabel}
                  onChange={(e) => setNewItemLabel(e.target.value)}
                  placeholder="e.g., Submit permit application"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Description (optional)</label>
                <Input
                  value={newItemDescription}
                  onChange={(e) => setNewItemDescription(e.target.value)}
                  placeholder="e.g., Upload the permit to the documents area"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Trade Type (optional)</label>
                <Select value={newItemTradeType} onValueChange={setNewItemTradeType}>
                  <SelectTrigger><SelectValue placeholder="All trades" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">All trades</SelectItem>
                    <SelectItem value="roofing">Roofing</SelectItem>
                    <SelectItem value="siding">Siding</SelectItem>
                    <SelectItem value="gutters">Gutters</SelectItem>
                    <SelectItem value="solar">Solar</SelectItem>
                    <SelectItem value="painting">Painting</SelectItem>
                    <SelectItem value="windows">Windows</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={newItemRequired}
                  onCheckedChange={(c) => setNewItemRequired(!!c)}
                />
                <label className="text-sm">Required to advance stage</label>
              </div>
            </div>
            <DialogFooter>
              <Button onClick={() => addMutation.mutate()} disabled={!newItemLabel.trim()}>
                <Save className="h-4 w-4 mr-1" /> Save
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {STAGE_CONFIG.map(stage => {
        const stageTemplates = templates.filter(t => t.stage_key === stage.key);

        return (
          <Card key={stage.key}>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <div className={cn('w-5 h-5 rounded-full flex items-center justify-center', stage.color)}>
                  <stage.icon className="h-3 w-3 text-white" />
                </div>
                {stage.name}
                <Badge variant="secondary" className="text-[10px]">{stageTemplates.length} items</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {stageTemplates.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2">No items configured for this stage.</p>
              ) : (
                <div className="space-y-1">
                  {stageTemplates.map(template => (
                    <div key={template.id} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/50">
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        <span className="text-sm truncate">{template.item_label}</span>
                        {template.is_required && (
                          <Badge variant="destructive" className="text-[9px] px-1 py-0 shrink-0">Required</Badge>
                        )}
                        {template.trade_type && (
                          <Badge variant="outline" className="text-[9px] px-1 py-0 capitalize shrink-0">
                            {template.trade_type}
                          </Badge>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-destructive hover:text-destructive shrink-0"
                        onClick={() => deleteMutation.mutate(template.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
};
