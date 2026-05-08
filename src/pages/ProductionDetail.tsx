import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';
import {
  ArrowLeft, CheckCircle, Circle, Plus, Trash2, Edit2, Save,
  FileText, Clock, Package, Wrench, Trophy, Search, Archive,
  Settings, Filter, AlertTriangle, ChevronRight, ExternalLink
} from 'lucide-react';
import { OrderAssignmentsPanel } from '@/components/production/OrderAssignmentsPanel';
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

const ProductionDetail = () => {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const effectiveTenantId = useEffectiveTenantId();
  const [activeTradeFilter, setActiveTradeFilter] = React.useState<string>('all');
  const [editingChecklist, setEditingChecklist] = React.useState(false);
  const [newItemLabel, setNewItemLabel] = React.useState('');
  const [newItemStage, setNewItemStage] = React.useState('submit_documents');
  const [newItemRequired, setNewItemRequired] = React.useState(true);
  const [addDialogOpen, setAddDialogOpen] = React.useState(false);

  // Fetch project + workflow data
  const { data: projectData, isLoading: projectLoading } = useQuery({
    queryKey: ['production-detail', projectId],
    queryFn: async () => {
      const { data: project, error } = await supabase
        .from('projects')
        .select(`
          *,
          pipeline_entries!inner(*, contacts(*)),
          estimates(*),
          payments(*)
        `)
        .eq('id', projectId!)
        .single();
      if (error) throw error;

      const { data: workflow } = await supabase
        .from('production_workflows')
        .select('*')
        .eq('project_id', projectId!)
        .single();

      return { project, workflow };
    },
    enabled: !!projectId,
  });

  // Fetch trade boards for this project
  const { data: tradeBoards = [] } = useQuery({
    queryKey: ['trade-boards', projectId, effectiveTenantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('production_trade_boards')
        .select('*')
        .eq('project_id', projectId!)
        .eq('tenant_id', effectiveTenantId!);
      if (error) throw error;
      return data || [];
    },
    enabled: !!projectId && !!effectiveTenantId,
  });

  // Fetch checklist templates
  const { data: checklistTemplates = [] } = useQuery({
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

  // Fetch checklist completions for this workflow
  const { data: checklistCompletions = [] } = useQuery({
    queryKey: ['checklist-completions', projectData?.workflow?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('production_checklist_completions')
        .select('*')
        .eq('production_workflow_id', projectData!.workflow!.id);
      if (error) throw error;
      return data || [];
    },
    enabled: !!projectData?.workflow?.id,
  });

  // Fetch trade checklist completions
  const { data: tradeChecklistCompletions = [] } = useQuery({
    queryKey: ['trade-checklist-completions', tradeBoards.map(t => t.id)],
    queryFn: async () => {
      if (!tradeBoards.length) return [];
      const { data, error } = await supabase
        .from('production_trade_checklist_completions')
        .select('*')
        .in('trade_board_id', tradeBoards.map(t => t.id));
      if (error) throw error;
      return data || [];
    },
    enabled: tradeBoards.length > 0,
  });

  // Toggle checklist item completion
  const toggleChecklistMutation = useMutation({
    mutationFn: async ({ templateId, completed }: { templateId: string; completed: boolean }) => {
      const workflowId = projectData?.workflow?.id;
      if (!workflowId || !effectiveTenantId) throw new Error('Missing workflow');

      const { data: existing } = await supabase
        .from('production_checklist_completions')
        .select('id')
        .eq('production_workflow_id', workflowId)
        .eq('checklist_template_id', templateId)
        .maybeSingle();

      if (existing) {
        await supabase
          .from('production_checklist_completions')
          .update({
            completed,
            completed_by: completed ? (await supabase.auth.getUser()).data.user?.id : null,
            completed_at: completed ? new Date().toISOString() : null,
          })
          .eq('id', existing.id);
      } else {
        await supabase
          .from('production_checklist_completions')
          .insert({
            tenant_id: effectiveTenantId,
            production_workflow_id: workflowId,
            checklist_template_id: templateId,
            completed,
            completed_by: completed ? (await supabase.auth.getUser()).data.user?.id : null,
            completed_at: completed ? new Date().toISOString() : null,
          });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['checklist-completions'] });
    },
  });

  // Toggle trade checklist completion
  const toggleTradeChecklistMutation = useMutation({
    mutationFn: async ({ tradeBoardId, templateId, completed }: { tradeBoardId: string; templateId: string; completed: boolean }) => {
      if (!effectiveTenantId) throw new Error('Missing tenant');

      const { data: existing } = await supabase
        .from('production_trade_checklist_completions')
        .select('id')
        .eq('trade_board_id', tradeBoardId)
        .eq('checklist_template_id', templateId)
        .maybeSingle();

      if (existing) {
        await supabase
          .from('production_trade_checklist_completions')
          .update({
            completed,
            completed_by: completed ? (await supabase.auth.getUser()).data.user?.id : null,
            completed_at: completed ? new Date().toISOString() : null,
          })
          .eq('id', existing.id);
      } else {
        await supabase
          .from('production_trade_checklist_completions')
          .insert({
            tenant_id: effectiveTenantId,
            trade_board_id: tradeBoardId,
            checklist_template_id: templateId,
            completed,
            completed_by: completed ? (await supabase.auth.getUser()).data.user?.id : null,
            completed_at: completed ? new Date().toISOString() : null,
          });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trade-checklist-completions'] });
    },
  });

  // Add new checklist template
  const addTemplateMutation = useMutation({
    mutationFn: async () => {
      if (!effectiveTenantId || !newItemLabel.trim()) return;
      const { data: { user } } = await supabase.auth.getUser();
      const maxSort = checklistTemplates
        .filter(t => t.stage_key === newItemStage)
        .reduce((max, t) => Math.max(max, t.sort_order || 0), 0);

      await supabase.from('production_checklist_templates').insert({
        tenant_id: effectiveTenantId,
        stage_key: newItemStage,
        item_label: newItemLabel.trim(),
        is_required: newItemRequired,
        sort_order: maxSort + 1,
        created_by: user?.id,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['checklist-templates'] });
      setNewItemLabel('');
      setAddDialogOpen(false);
      toast({ title: 'Checklist item added' });
    },
  });

  // Delete checklist template
  const deleteTemplateMutation = useMutation({
    mutationFn: async (templateId: string) => {
      await supabase.from('production_checklist_templates').delete().eq('id', templateId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['checklist-templates'] });
      toast({ title: 'Checklist item removed' });
    },
  });

  // Move trade board stage
  const moveTradeStage = useMutation({
    mutationFn: async ({ tradeBoardId, newStage }: { tradeBoardId: string; newStage: string }) => {
      await supabase
        .from('production_trade_boards')
        .update({ current_stage: newStage, updated_at: new Date().toISOString() })
        .eq('id', tradeBoardId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trade-boards'] });
      toast({ title: 'Trade stage updated' });
    },
  });

  if (projectLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  const project = projectData?.project;
  const workflow = projectData?.workflow;
  const contact = project?.pipeline_entries?.contacts;
  const estimates = project?.estimates || [];
  const currentStage = STAGE_CONFIG.find(s => s.key === workflow?.current_stage);

  const getCompletionForTemplate = (templateId: string) => {
    return checklistCompletions.find(c => c.checklist_template_id === templateId);
  };

  const getTradeCompletionForTemplate = (tradeBoardId: string, templateId: string) => {
    return tradeChecklistCompletions.find(
      c => c.trade_board_id === tradeBoardId && c.checklist_template_id === templateId
    );
  };

  const filteredTradeBoards = activeTradeFilter === 'all'
    ? tradeBoards
    : tradeBoards.filter(tb => tb.trade_type === activeTradeFilter);

  const uniqueTradeTypes = [...new Set(tradeBoards.map(tb => tb.trade_type))];

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/production')}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">
              {contact ? `${contact.first_name} ${contact.last_name}` : project?.name || 'Project'}
            </h1>
            <p className="text-sm text-muted-foreground">
              {contact?.address_street}{contact?.address_city ? `, ${contact.address_city}` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {currentStage && (
            <Badge className={cn('text-white', currentStage.color)}>
              {currentStage.name}
            </Badge>
          )}
          <span className="text-sm text-muted-foreground">
            {estimates.length > 0
              ? `Contract: $${Number(estimates[0].selling_price || 0).toLocaleString()}`
              : 'No estimate'}
          </span>
        </div>
      </div>

      {/* Trade Type Filter */}
      {uniqueTradeTypes.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <Badge
            variant={activeTradeFilter === 'all' ? 'default' : 'outline'}
            className="cursor-pointer"
            onClick={() => setActiveTradeFilter('all')}
          >
            All Trades
          </Badge>
          {uniqueTradeTypes.map(type => (
            <Badge
              key={type}
              variant={activeTradeFilter === type ? 'default' : 'outline'}
              className="cursor-pointer capitalize"
              onClick={() => setActiveTradeFilter(type)}
            >
              {type.replace(/_/g, ' ')}
            </Badge>
          ))}
        </div>
      )}

      <Tabs defaultValue="checklist" className="w-full">
        <TabsList>
          <TabsTrigger value="checklist">Production Checklist</TabsTrigger>
          <TabsTrigger value="orders">Orders & Assignments</TabsTrigger>
          <TabsTrigger value="trades">Trade Boards ({tradeBoards.length})</TabsTrigger>
          <TabsTrigger value="settings">
            <Settings className="h-4 w-4 mr-1" />
            Manage Checklist
          </TabsTrigger>
        </TabsList>

        {/* PRODUCTION CHECKLIST TAB */}
        <TabsContent value="checklist" className="space-y-4">
          {STAGE_CONFIG.map(stage => {
            const stageTemplates = checklistTemplates.filter(
              t => t.stage_key === stage.key && (!t.trade_type || activeTradeFilter === 'all' || t.trade_type === activeTradeFilter)
            );
            if (stageTemplates.length === 0) return null;

            const completedCount = stageTemplates.filter(t => {
              const completion = getCompletionForTemplate(t.id);
              return completion?.completed;
            }).length;

            const isCurrentStage = workflow?.current_stage === stage.key;

            return (
              <Card key={stage.key} className={cn(isCurrentStage && 'ring-2 ring-primary')}>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center justify-between text-sm">
                    <div className="flex items-center gap-2">
                      <div className={cn('w-5 h-5 rounded-full flex items-center justify-center', stage.color)}>
                        <stage.icon className="h-3 w-3 text-white" />
                      </div>
                      <span>{stage.name}</span>
                      {isCurrentStage && <Badge variant="secondary" className="text-[10px]">Current</Badge>}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {completedCount}/{stageTemplates.length} completed
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {stageTemplates.map(template => {
                    const completion = getCompletionForTemplate(template.id);
                    const isCompleted = completion?.completed || false;
                    return (
                      <div key={template.id} className="flex items-center gap-3 py-1">
                        <Checkbox
                          checked={isCompleted}
                          onCheckedChange={(checked) => {
                            toggleChecklistMutation.mutate({
                              templateId: template.id,
                              completed: !!checked,
                            });
                          }}
                        />
                        <span className={cn(
                          'text-sm flex-1',
                          isCompleted && 'line-through text-muted-foreground'
                        )}>
                          {template.item_label}
                        </span>
                        {template.is_required && (
                          <Badge variant="destructive" className="text-[9px] px-1 py-0">Required</Badge>
                        )}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            );
          })}

          {checklistTemplates.length === 0 && (
            <Card className="border-dashed">
              <CardContent className="py-8 text-center text-muted-foreground">
                <p>No checklist items configured yet.</p>
                <p className="text-sm mt-1">Go to the "Manage Checklist" tab to add items for each production stage.</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ORDERS & ASSIGNMENTS TAB */}
        <TabsContent value="orders" className="space-y-4">
          <OrderAssignmentsPanel projectId={projectId!} />
        </TabsContent>

        {/* TRADE BOARDS TAB */}
        <TabsContent value="trades" className="space-y-4">
          {filteredTradeBoards.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-8 text-center text-muted-foreground">
                <Package className="h-10 w-10 mx-auto mb-3 opacity-50" />
                <p>No trade boards found for this project.</p>
                <p className="text-sm mt-1">
                  Trade boards are auto-created from estimate categories when a job is converted.
                </p>
              </CardContent>
            </Card>
          ) : (
            filteredTradeBoards.map(trade => {
              const tradeStage = STAGE_CONFIG.find(s => s.key === trade.current_stage);
              const tradeTemplates = checklistTemplates.filter(
                t => t.stage_key === trade.current_stage && (!t.trade_type || t.trade_type === trade.trade_type)
              );
              const tradeCompletedCount = tradeTemplates.filter(t => {
                const c = getTradeCompletionForTemplate(trade.id, t.id);
                return c?.completed;
              }).length;

              return (
                <Card key={trade.id}>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Package className="h-4 w-4" />
                        <span className="capitalize">{trade.trade_name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {tradeStage && (
                          <Badge className={cn('text-white text-xs', tradeStage.color)}>
                            {tradeStage.name}
                          </Badge>
                        )}
                        <Select
                          value={trade.current_stage}
                          onValueChange={(val) => moveTradeStage.mutate({ tradeBoardId: trade.id, newStage: val })}
                        >
                          <SelectTrigger className="w-[140px] h-7 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {STAGE_CONFIG.map(s => (
                              <SelectItem key={s.key} value={s.key} className="text-xs">
                                {s.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {tradeTemplates.length > 0 ? (
                      <>
                        <p className="text-xs text-muted-foreground mb-2">
                          {tradeCompletedCount}/{tradeTemplates.length} checklist items complete
                        </p>
                        {tradeTemplates.map(template => {
                          const completion = getTradeCompletionForTemplate(trade.id, template.id);
                          const isCompleted = completion?.completed || false;
                          return (
                            <div key={template.id} className="flex items-center gap-3 py-1">
                              <Checkbox
                                checked={isCompleted}
                                onCheckedChange={(checked) => {
                                  toggleTradeChecklistMutation.mutate({
                                    tradeBoardId: trade.id,
                                    templateId: template.id,
                                    completed: !!checked,
                                  });
                                }}
                              />
                              <span className={cn(
                                'text-sm flex-1',
                                isCompleted && 'line-through text-muted-foreground'
                              )}>
                                {template.item_label}
                              </span>
                              {template.is_required && (
                                <Badge variant="destructive" className="text-[9px] px-1 py-0">Required</Badge>
                              )}
                            </div>
                          );
                        })}
                      </>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        No checklist items for this stage. Add items in "Manage Checklist".
                      </p>
                    )}
                  </CardContent>
                </Card>
              );
            })
          )}
        </TabsContent>

        {/* MANAGE CHECKLIST TAB (Backend Editor) */}
        <TabsContent value="settings" className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">
              Configure required checklist items for each production stage. These apply to all projects.
            </p>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => navigate('/settings?tab=production-checklist')}>
                <ExternalLink className="h-3 w-3 mr-1" /> Open in Settings
              </Button>
            </div>
            <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm">
                  <Plus className="h-4 w-4 mr-1" /> Add Item
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add Checklist Item</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                  <div>
                    <label className="text-sm font-medium">Stage</label>
                    <Select value={newItemStage} onValueChange={setNewItemStage}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
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
                      placeholder="e.g., Upload NOC document"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      checked={newItemRequired}
                      onCheckedChange={(c) => setNewItemRequired(!!c)}
                    />
                    <label className="text-sm">Required to advance</label>
                  </div>
                </div>
                <DialogFooter>
                  <Button
                    onClick={() => addTemplateMutation.mutate()}
                    disabled={!newItemLabel.trim()}
                  >
                    <Save className="h-4 w-4 mr-1" /> Save
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          {STAGE_CONFIG.map(stage => {
            const stageTemplates = checklistTemplates.filter(t => t.stage_key === stage.key);
            if (stageTemplates.length === 0) return null;

            return (
              <Card key={stage.key}>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <div className={cn('w-4 h-4 rounded-full', stage.color)} />
                    {stage.name}
                    <Badge variant="secondary" className="text-[10px]">{stageTemplates.length} items</Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-1">
                  {stageTemplates.map(template => (
                    <div key={template.id} className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-muted/50">
                      <div className="flex items-center gap-2">
                        <span className="text-sm">{template.item_label}</span>
                        {template.is_required && (
                          <Badge variant="destructive" className="text-[9px] px-1 py-0">Required</Badge>
                        )}
                        {template.trade_type && (
                          <Badge variant="outline" className="text-[9px] px-1 py-0 capitalize">
                            {template.trade_type}
                          </Badge>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 text-destructive hover:text-destructive"
                        onClick={() => deleteTemplateMutation.mutate(template.id)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </CardContent>
              </Card>
            );
          })}

          {checklistTemplates.length === 0 && (
            <Card className="border-dashed">
              <CardContent className="py-8 text-center text-muted-foreground">
                <p>No checklist items configured. Click "Add Item" to get started.</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default ProductionDetail;
