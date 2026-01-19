import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  Plus,
  Trash2,
  Edit,
  Play,
  Pause,
  Zap,
  Mail,
  MessageSquare,
  CheckSquare,
  ArrowRight,
  Globe,
  FileText,
  CreditCard,
  Clock,
  History,
  AlertCircle,
  CheckCircle,
  XCircle,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import type { Json } from '@/integrations/supabase/types';

// ============================================
// TYPES - Aligned with actual database schema
// ============================================

interface Action {
  type: string;
  params: Record<string, any>;
}

interface TriggerConditions {
  field?: string;
  operator?: string;
  value?: string;
  conditions?: Array<{
    field: string;
    operator: string;
    value: string;
  }>;
  logic?: 'and' | 'or';
}

interface Automation {
  id: string;
  name: string;
  description?: string | null;
  trigger_type: string;
  trigger_conditions: TriggerConditions | null;
  actions: Action[] | null;
  is_active: boolean | null;
  created_at: string | null;
  updated_at: string | null;
  tenant_id: string;
}

interface AutomationLog {
  id: string;
  triggered_at: string | null;
  status: string | null;
  trigger_data: any;
  execution_result: any;
  error_message: string | null;
}

// ============================================
// CONSTANTS
// ============================================

const TRIGGER_TYPES = [
  { type: 'lead_created', label: 'Lead Created', category: 'Lead Events', icon: Zap },
  { type: 'lead_status_changed', label: 'Lead Status Changed', category: 'Lead Events', icon: Zap },
  { type: 'pipeline_stage_changed', label: 'Pipeline Stage Changed', category: 'Pipeline Events', icon: ArrowRight },
  { type: 'contract_sent', label: 'Contract Sent', category: 'Contract Events', icon: FileText },
  { type: 'contract_signed', label: 'Contract Signed', category: 'Contract Events', icon: FileText },
  { type: 'payment_received', label: 'Payment Received', category: 'Financial Events', icon: CreditCard },
  { type: 'appointment_scheduled', label: 'Appointment Scheduled', category: 'Appointment Events', icon: Clock },
  { type: 'job_milestone_changed', label: 'Job Milestone Changed', category: 'Job Events', icon: CheckSquare },
  { type: 'manual', label: 'Manual Trigger', category: 'Other', icon: Play },
];

const CONDITION_OPERATORS = [
  { value: 'eq', label: 'Equals' },
  { value: 'ne', label: 'Not Equals' },
  { value: 'gt', label: 'Greater Than' },
  { value: 'gte', label: 'Greater Than or Equal' },
  { value: 'lt', label: 'Less Than' },
  { value: 'lte', label: 'Less Than or Equal' },
  { value: 'contains', label: 'Contains' },
  { value: 'in', label: 'In List' },
  { value: 'nin', label: 'Not In List' },
];

const ACTION_TYPES = [
  { type: 'send_email', label: 'Send Email', icon: Mail },
  { type: 'send_sms', label: 'Send SMS', icon: MessageSquare },
  { type: 'assign_task', label: 'Assign Task', icon: CheckSquare },
  { type: 'change_status', label: 'Change Status', icon: ArrowRight },
  { type: 'webhook', label: 'Send Webhook', icon: Globe },
  { type: 'push_doc', label: 'Push Document', icon: FileText },
  { type: 'create_payment_link', label: 'Create Payment Link', icon: CreditCard },
];

// ============================================
// MAIN COMPONENT
// ============================================

export const EnhancedAutomationManager: React.FC = () => {
  const [automations, setAutomations] = useState<Automation[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAutomation, setEditingAutomation] = useState<Automation | null>(null);
  const [selectedAutomationId, setSelectedAutomationId] = useState<string | null>(null);
  const [logs, setLogs] = useState<AutomationLog[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const { toast } = useToast();

  // Form state - aligned with actual schema
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    is_active: true,
    trigger_type: '',
    trigger_conditions: {
      conditions: [] as Array<{ field: string; operator: string; value: string }>,
      logic: 'and' as 'and' | 'or',
    },
    actions: [] as Action[],
  });

  const fetchAutomations = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('automations')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      // Parse and normalize data
      const parsed = (data || []).map((a) => ({
        ...a,
        trigger_conditions: (a.trigger_conditions as unknown as TriggerConditions) || { conditions: [], logic: 'and' },
        actions: Array.isArray(a.actions) ? (a.actions as unknown as Action[]) : [],
      }));
      
      setAutomations(parsed);
    } catch (error) {
      console.error('Error fetching automations:', error);
      toast({
        title: 'Error',
        description: 'Failed to load automations',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const fetchLogs = useCallback(async (automationId: string) => {
    setLogsLoading(true);
    try {
      const { data, error } = await supabase
        .from('automation_logs')
        .select('*')
        .eq('automation_id', automationId)
        .order('triggered_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      setLogs((data || []) as AutomationLog[]);
    } catch (error) {
      console.error('Error fetching logs:', error);
    } finally {
      setLogsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAutomations();
  }, [fetchAutomations]);

  useEffect(() => {
    if (selectedAutomationId) {
      fetchLogs(selectedAutomationId);
    }
  }, [selectedAutomationId, fetchLogs]);

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      is_active: true,
      trigger_type: '',
      trigger_conditions: { conditions: [], logic: 'and' },
      actions: [],
    });
    setEditingAutomation(null);
  };

  const openCreateDialog = () => {
    resetForm();
    setDialogOpen(true);
  };

  const openEditDialog = (automation: Automation) => {
    setEditingAutomation(automation);
    const triggerConds = automation.trigger_conditions || { conditions: [], logic: 'and' };
    setFormData({
      name: automation.name,
      description: automation.description || '',
      is_active: automation.is_active ?? true,
      trigger_type: automation.trigger_type,
      trigger_conditions: {
        conditions: triggerConds.conditions || [],
        logic: triggerConds.logic || 'and',
      },
      actions: automation.actions || [],
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formData.name) {
      toast({ title: 'Error', description: 'Name is required', variant: 'destructive' });
      return;
    }

    if (!formData.trigger_type) {
      toast({ title: 'Error', description: 'Trigger type is required', variant: 'destructive' });
      return;
    }

    if (formData.actions.length === 0) {
      toast({ title: 'Error', description: 'At least one action is required', variant: 'destructive' });
      return;
    }

    try {
      const automationData = {
        name: formData.name,
        description: formData.description || null,
        trigger_type: formData.trigger_type,
        trigger_conditions: formData.trigger_conditions as unknown as Json,
        actions: formData.actions as unknown as Json,
        is_active: formData.is_active,
        updated_at: new Date().toISOString(),
      };

      if (editingAutomation) {
        const { error } = await supabase
          .from('automations')
          .update(automationData)
          .eq('id', editingAutomation.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('automations')
          .insert(automationData);
        if (error) throw error;
      }

      toast({
        title: 'Success',
        description: `Automation ${editingAutomation ? 'updated' : 'created'} successfully`,
      });

      setDialogOpen(false);
      resetForm();
      fetchAutomations();
    } catch (error) {
      console.error('Error saving automation:', error);
      toast({
        title: 'Error',
        description: 'Failed to save automation',
        variant: 'destructive',
      });
    }
  };

  const toggleAutomation = async (id: string, currentStatus: boolean | null) => {
    try {
      const { error } = await supabase
        .from('automations')
        .update({ is_active: !currentStatus, updated_at: new Date().toISOString() })
        .eq('id', id);
      
      if (error) throw error;

      toast({
        title: 'Success',
        description: `Automation ${!currentStatus ? 'activated' : 'deactivated'}`,
      });

      fetchAutomations();
    } catch (error) {
      console.error('Error toggling automation:', error);
      toast({
        title: 'Error',
        description: 'Failed to toggle automation',
        variant: 'destructive',
      });
    }
  };

  const deleteAutomation = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this automation?')) return;

    try {
      const { error } = await supabase.from('automations').delete().eq('id', id);
      if (error) throw error;

      toast({ title: 'Success', description: 'Automation deleted' });
      fetchAutomations();
    } catch (error) {
      console.error('Error deleting automation:', error);
      toast({
        title: 'Error',
        description: 'Failed to delete automation',
        variant: 'destructive',
      });
    }
  };

  // ============================================
  // CONDITION MANAGEMENT
  // ============================================

  const addCondition = () => {
    setFormData((prev) => ({
      ...prev,
      trigger_conditions: {
        ...prev.trigger_conditions,
        conditions: [...prev.trigger_conditions.conditions, { field: '', operator: 'eq', value: '' }],
      },
    }));
  };

  const updateCondition = (index: number, updates: Partial<{ field: string; operator: string; value: string }>) => {
    setFormData((prev) => ({
      ...prev,
      trigger_conditions: {
        ...prev.trigger_conditions,
        conditions: prev.trigger_conditions.conditions.map((c, i) => 
          i === index ? { ...c, ...updates } : c
        ),
      },
    }));
  };

  const removeCondition = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      trigger_conditions: {
        ...prev.trigger_conditions,
        conditions: prev.trigger_conditions.conditions.filter((_, i) => i !== index),
      },
    }));
  };

  // ============================================
  // ACTION MANAGEMENT
  // ============================================

  const addAction = (type: string) => {
    const defaultParams: Record<string, any> = {};
    
    switch (type) {
      case 'send_email':
        defaultParams.recipient_type = 'contact';
        defaultParams.subject = '';
        defaultParams.body = '';
        break;
      case 'send_sms':
        defaultParams.recipient_type = 'contact';
        defaultParams.message = '';
        break;
      case 'assign_task':
        defaultParams.title = '';
        defaultParams.description = '';
        defaultParams.due_date_offset = 24;
        defaultParams.priority = 'medium';
        defaultParams.assignee_type = 'sales_rep';
        break;
      case 'change_status':
        defaultParams.entity_type = 'contact';
        defaultParams.new_status = '';
        break;
      case 'webhook':
        defaultParams.url = '';
        defaultParams.method = 'POST';
        break;
      case 'push_doc':
        defaultParams.template_id = '';
        defaultParams.recipient_type = 'contact';
        break;
      case 'create_payment_link':
        defaultParams.recipient_type = 'contact';
        defaultParams.product_name = 'Payment';
        break;
    }

    setFormData((prev) => ({
      ...prev,
      actions: [...prev.actions, { type, params: defaultParams }],
    }));
  };

  const updateAction = (index: number, params: Record<string, any>) => {
    setFormData((prev) => ({
      ...prev,
      actions: prev.actions.map((a, i) => (i === index ? { ...a, params } : a)),
    }));
  };

  const removeAction = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      actions: prev.actions.filter((_, i) => i !== index),
    }));
  };

  // ============================================
  // RENDER HELPERS
  // ============================================

  const getTriggerLabel = (type: string) => {
    return TRIGGER_TYPES.find((t) => t.type === type)?.label || type;
  };

  const getActionIcon = (type: string) => {
    const action = ACTION_TYPES.find((a) => a.type === type);
    return action?.icon || Zap;
  };

  const renderActionParams = (action: Action, index: number) => {
    const { type, params } = action;

    switch (type) {
      case 'send_email':
        return (
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Subject</Label>
              <Input
                value={params.subject || ''}
                onChange={(e) => updateAction(index, { ...params, subject: e.target.value })}
                placeholder="Email subject..."
              />
            </div>
            <div>
              <Label className="text-xs">Body</Label>
              <Textarea
                value={params.body || ''}
                onChange={(e) => updateAction(index, { ...params, body: e.target.value })}
                placeholder="Email body... Use {{contact.first_name}} for dynamic tags"
                rows={3}
              />
            </div>
          </div>
        );

      case 'send_sms':
        return (
          <div>
            <Label className="text-xs">Message</Label>
            <Textarea
              value={params.message || ''}
              onChange={(e) => updateAction(index, { ...params, message: e.target.value })}
              placeholder="SMS message... Use {{contact.first_name}} for dynamic tags"
              rows={2}
            />
          </div>
        );

      case 'assign_task':
        return (
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Task Title</Label>
              <Input
                value={params.title || ''}
                onChange={(e) => updateAction(index, { ...params, title: e.target.value })}
                placeholder="Task title..."
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Due In (hours)</Label>
                <Input
                  type="number"
                  value={params.due_date_offset || 24}
                  onChange={(e) => updateAction(index, { ...params, due_date_offset: parseInt(e.target.value) })}
                />
              </div>
              <div>
                <Label className="text-xs">Priority</Label>
                <Select
                  value={params.priority || 'medium'}
                  onValueChange={(v) => updateAction(index, { ...params, priority: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                    <SelectItem value="urgent">Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        );

      case 'webhook':
        return (
          <div className="space-y-3">
            <div>
              <Label className="text-xs">URL</Label>
              <Input
                value={params.url || ''}
                onChange={(e) => updateAction(index, { ...params, url: e.target.value })}
                placeholder="https://..."
              />
            </div>
            <div>
              <Label className="text-xs">Method</Label>
              <Select
                value={params.method || 'POST'}
                onValueChange={(v) => updateAction(index, { ...params, method: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="POST">POST</SelectItem>
                  <SelectItem value="PUT">PUT</SelectItem>
                  <SelectItem value="GET">GET</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        );

      case 'change_status':
        return (
          <div>
            <Label className="text-xs">New Status</Label>
            <Input
              value={params.new_status || ''}
              onChange={(e) => updateAction(index, { ...params, new_status: e.target.value })}
              placeholder="e.g., qualified, appointment_set"
            />
          </div>
        );

      default:
        return (
          <div className="text-xs text-muted-foreground">
            Configure this action via JSON params
          </div>
        );
    }
  };

  // ============================================
  // RENDER
  // ============================================

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Automations</h2>
          <p className="text-muted-foreground">
            Create automated workflows triggered by events
          </p>
        </div>
        <Button onClick={openCreateDialog}>
          <Plus className="h-4 w-4 mr-2" />
          Create Automation
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
        </div>
      ) : automations.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Zap className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No automations yet</h3>
            <p className="text-muted-foreground mb-4">
              Create your first automation to streamline your workflows
            </p>
            <Button onClick={openCreateDialog}>
              <Plus className="h-4 w-4 mr-2" />
              Create Automation
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {automations.map((automation) => (
            <Card key={automation.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold">{automation.name}</h3>
                      <Badge variant={automation.is_active ? 'default' : 'secondary'}>
                        {automation.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                    </div>
                    {automation.description && (
                      <p className="text-sm text-muted-foreground mb-2">
                        {automation.description}
                      </p>
                    )}
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Badge variant="outline" className="text-xs">
                        <Zap className="h-3 w-3 mr-1" />
                        {getTriggerLabel(automation.trigger_type)}
                      </Badge>
                      {(automation.actions?.length || 0) > 0 && (
                        <span>→ {automation.actions?.length} action(s)</span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={automation.is_active ?? false}
                      onCheckedChange={() => toggleAutomation(automation.id, automation.is_active)}
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openEditDialog(automation)}
                    >
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        setSelectedAutomationId(automation.id);
                      }}
                    >
                      <History className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => deleteAutomation(automation.id)}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingAutomation ? 'Edit Automation' : 'Create Automation'}
            </DialogTitle>
            <DialogDescription>
              Configure triggers, conditions, and actions for your automation
            </DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="basics" className="w-full">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="basics">Basics</TabsTrigger>
              <TabsTrigger value="trigger">Trigger</TabsTrigger>
              <TabsTrigger value="conditions">Conditions</TabsTrigger>
              <TabsTrigger value="actions">Actions</TabsTrigger>
            </TabsList>

            <TabsContent value="basics" className="space-y-4 mt-4">
              <div>
                <Label>Name *</Label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="My Automation"
                />
              </div>
              <div>
                <Label>Description</Label>
                <Textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Describe what this automation does..."
                  rows={3}
                />
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={formData.is_active}
                  onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                />
                <Label>Active</Label>
              </div>
            </TabsContent>

            <TabsContent value="trigger" className="space-y-4 mt-4">
              <div>
                <Label>Trigger Event *</Label>
                <Select
                  value={formData.trigger_type}
                  onValueChange={(v) => setFormData({ ...formData, trigger_type: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a trigger..." />
                  </SelectTrigger>
                  <SelectContent>
                    {TRIGGER_TYPES.map((trigger) => (
                      <SelectItem key={trigger.type} value={trigger.type}>
                        <div className="flex items-center gap-2">
                          <trigger.icon className="h-4 w-4" />
                          {trigger.label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {formData.trigger_type && (
                <div className="p-4 bg-muted rounded-lg">
                  <p className="text-sm">
                    This automation will run when: <strong>{getTriggerLabel(formData.trigger_type)}</strong>
                  </p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="conditions" className="space-y-4 mt-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Conditions</Label>
                  <p className="text-xs text-muted-foreground">
                    Optional filters to control when the automation runs
                  </p>
                </div>
                <Select
                  value={formData.trigger_conditions.logic}
                  onValueChange={(v: 'and' | 'or') => 
                    setFormData({
                      ...formData,
                      trigger_conditions: { ...formData.trigger_conditions, logic: v },
                    })
                  }
                >
                  <SelectTrigger className="w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="and">AND</SelectItem>
                    <SelectItem value="or">OR</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                {formData.trigger_conditions.conditions.map((condition, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      value={condition.field}
                      onChange={(e) => updateCondition(index, { field: e.target.value })}
                      placeholder="Field (e.g., contact.status)"
                      className="flex-1"
                    />
                    <Select
                      value={condition.operator}
                      onValueChange={(v) => updateCondition(index, { operator: v })}
                    >
                      <SelectTrigger className="w-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CONDITION_OPERATORS.map((op) => (
                          <SelectItem key={op.value} value={op.value}>
                            {op.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      value={condition.value}
                      onChange={(e) => updateCondition(index, { value: e.target.value })}
                      placeholder="Value"
                      className="flex-1"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => removeCondition(index)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>

              <Button variant="outline" size="sm" onClick={addCondition}>
                <Plus className="h-4 w-4 mr-2" />
                Add Condition
              </Button>
            </TabsContent>

            <TabsContent value="actions" className="space-y-4 mt-4">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Actions *</Label>
                  <p className="text-xs text-muted-foreground">
                    What should happen when this automation runs
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                {formData.actions.map((action, index) => {
                  const ActionIcon = getActionIcon(action.type);
                  return (
                    <Card key={index}>
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between mb-3">
                          <div className="flex items-center gap-2">
                            <ActionIcon className="h-4 w-4" />
                            <span className="font-medium text-sm">
                              {ACTION_TYPES.find((a) => a.type === action.type)?.label}
                            </span>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => removeAction(index)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                        {renderActionParams(action, index)}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              <Accordion type="single" collapsible>
                <AccordionItem value="add-action">
                  <AccordionTrigger>
                    <div className="flex items-center gap-2">
                      <Plus className="h-4 w-4" />
                      Add Action
                    </div>
                  </AccordionTrigger>
                  <AccordionContent>
                    <div className="grid grid-cols-2 gap-2 pt-2">
                      {ACTION_TYPES.map((action) => (
                        <Button
                          key={action.type}
                          variant="outline"
                          className="justify-start"
                          onClick={() => addAction(action.type)}
                        >
                          <action.icon className="h-4 w-4 mr-2" />
                          {action.label}
                        </Button>
                      ))}
                    </div>
                  </AccordionContent>
                </AccordionItem>
              </Accordion>
            </TabsContent>
          </Tabs>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave}>
              {editingAutomation ? 'Update' : 'Create'} Automation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Logs Dialog */}
      <Dialog open={!!selectedAutomationId} onOpenChange={() => setSelectedAutomationId(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Automation Logs</DialogTitle>
            <DialogDescription>
              Recent execution history for this automation
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="h-[400px]">
            {logsLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
              </div>
            ) : logs.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No execution logs yet
              </div>
            ) : (
              <div className="space-y-2">
                {logs.map((log) => (
                  <Card key={log.id}>
                    <CardContent className="p-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {log.status === 'success' ? (
                            <CheckCircle className="h-4 w-4 text-green-500" />
                          ) : log.status === 'failed' ? (
                            <XCircle className="h-4 w-4 text-red-500" />
                          ) : (
                            <AlertCircle className="h-4 w-4 text-yellow-500" />
                          )}
                          <span className="text-sm font-medium">
                            {log.status || 'Unknown'}
                          </span>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {log.triggered_at ? new Date(log.triggered_at).toLocaleString() : 'N/A'}
                        </span>
                      </div>
                      {log.error_message && (
                        <p className="text-xs text-red-500 mt-2">{log.error_message}</p>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default EnhancedAutomationManager;
