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
import { AUTOMATION_EVENTS } from '@/lib/automations/triggerAutomation';

// ============================================
// TYPES
// ============================================

interface Trigger {
  type: string;
  params?: Record<string, any>;
}

interface Condition {
  field: string;
  operator: string;
  value: string;
}

interface Action {
  type: string;
  params: Record<string, any>;
}

interface Automation {
  id: string;
  name: string;
  description?: string;
  triggers: Trigger[];
  conditions: Condition[];
  actions: Action[];
  condition_logic: 'and' | 'or';
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

interface AutomationLog {
  id: number;
  fired_at: string;
  event: string;
  cause: string;
  input: any;
  outcome: string;
  result: any;
}

// ============================================
// CONSTANTS
// ============================================

const TRIGGER_CATEGORIES = {
  lead: {
    label: 'Lead Events',
    icon: Zap,
    triggers: [
      { type: 'lead_created', label: 'Lead Created' },
      { type: 'lead_status_changed', label: 'Lead Status Changed' },
      { type: 'lead_assigned', label: 'Lead Assigned' },
      { type: 'lead_score_updated', label: 'Lead Score Updated' },
    ],
  },
  pipeline: {
    label: 'Pipeline Events',
    icon: ArrowRight,
    triggers: [
      { type: 'pipeline_stage_changed', label: 'Pipeline Stage Changed' },
      { type: 'pipeline_entry_created', label: 'Pipeline Entry Created' },
    ],
  },
  contract: {
    label: 'Contract Events',
    icon: FileText,
    triggers: [
      { type: 'contract_sent', label: 'Contract Sent' },
      { type: 'contract_signed', label: 'Contract Signed' },
      { type: 'contract_expired', label: 'Contract Expired' },
      { type: 'change_order_requested', label: 'Change Order Requested' },
    ],
  },
  job: {
    label: 'Job Events',
    icon: CheckSquare,
    triggers: [
      { type: 'job_created', label: 'Job Created' },
      { type: 'job_milestone_changed', label: 'Job Milestone Changed' },
      { type: 'job_completed', label: 'Job Completed' },
    ],
  },
  appointment: {
    label: 'Appointment Events',
    icon: Clock,
    triggers: [
      { type: 'appointment_scheduled', label: 'Appointment Scheduled' },
      { type: 'appointment_confirmed', label: 'Appointment Confirmed' },
      { type: 'appointment_cancelled', label: 'Appointment Cancelled' },
      { type: 'appointment_completed', label: 'Appointment Completed' },
    ],
  },
  financial: {
    label: 'Financial Events',
    icon: CreditCard,
    triggers: [
      { type: 'payment_received', label: 'Payment Received' },
      { type: 'invoice_sent', label: 'Invoice Sent' },
      { type: 'invoice_overdue', label: 'Invoice Overdue' },
      { type: 'financing_approved', label: 'Financing Approved' },
    ],
  },
};

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

  // Form state
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    is_active: true,
    condition_logic: 'and' as 'and' | 'or',
    triggers: [] as Trigger[],
    conditions: [] as Condition[],
    actions: [] as Action[],
  });

  const fetchAutomations = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('automations')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      // Parse JSON fields
      const parsed = (data || []).map((a: any) => ({
        ...a,
        triggers: a.triggers || [],
        conditions: a.conditions || [],
        actions: a.actions || [],
        condition_logic: a.condition_logic || 'and',
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
        .order('fired_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      setLogs((data || []) as unknown as AutomationLog[]);
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
      condition_logic: 'and',
      triggers: [],
      conditions: [],
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
    setFormData({
      name: automation.name,
      description: automation.description || '',
      is_active: automation.is_active,
      condition_logic: automation.condition_logic,
      triggers: automation.triggers,
      conditions: automation.conditions,
      actions: automation.actions,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formData.name) {
      toast({ title: 'Error', description: 'Name is required', variant: 'destructive' });
      return;
    }

    if (formData.triggers.length === 0) {
      toast({ title: 'Error', description: 'At least one trigger is required', variant: 'destructive' });
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
        triggers: formData.triggers as unknown as any,
        conditions: formData.conditions.length > 0 ? formData.conditions as unknown as any : null,
        actions: formData.actions as unknown as any,
        condition_logic: formData.condition_logic,
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

  const toggleAutomation = async (id: string, currentStatus: boolean) => {
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
  // TRIGGER MANAGEMENT
  // ============================================

  const addTrigger = (type: string) => {
    setFormData((prev) => ({
      ...prev,
      triggers: [...prev.triggers, { type, params: {} }],
    }));
  };

  const removeTrigger = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      triggers: prev.triggers.filter((_, i) => i !== index),
    }));
  };

  // ============================================
  // CONDITION MANAGEMENT
  // ============================================

  const addCondition = () => {
    setFormData((prev) => ({
      ...prev,
      conditions: [...prev.conditions, { field: '', operator: 'eq', value: '' }],
    }));
  };

  const updateCondition = (index: number, updates: Partial<Condition>) => {
    setFormData((prev) => ({
      ...prev,
      conditions: prev.conditions.map((c, i) => (i === index ? { ...c, ...updates } : c)),
    }));
  };

  const removeCondition = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      conditions: prev.conditions.filter((_, i) => i !== index),
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
  // RENDER
  // ============================================

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold">Automation Manager</h2>
          <p className="text-muted-foreground">
            Create powerful automations to streamline your workflows
          </p>
        </div>
        <Button onClick={openCreateDialog}>
          <Plus className="w-4 h-4 mr-2" />
          Create Automation
        </Button>
      </div>

      <Tabs defaultValue="automations" className="w-full">
        <TabsList>
          <TabsTrigger value="automations">Automations ({automations.length})</TabsTrigger>
          <TabsTrigger value="logs">Execution Logs</TabsTrigger>
        </TabsList>

        <TabsContent value="automations" className="mt-4">
          {automations.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Zap className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-medium">No automations yet</h3>
                <p className="text-muted-foreground mb-4">
                  Create your first automation to get started
                </p>
                <Button onClick={openCreateDialog}>Create Automation</Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4">
              {automations.map((automation) => (
                <AutomationCard
                  key={automation.id}
                  automation={automation}
                  onEdit={() => openEditDialog(automation)}
                  onToggle={() => toggleAutomation(automation.id, automation.is_active)}
                  onDelete={() => deleteAutomation(automation.id)}
                  onViewLogs={() => setSelectedAutomationId(automation.id)}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="logs" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="h-5 w-5" />
                Execution History
              </CardTitle>
              <CardDescription>
                {selectedAutomationId
                  ? `Showing logs for selected automation`
                  : 'Select an automation to view its logs'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {selectedAutomationId ? (
                <LogsTable logs={logs} loading={logsLoading} />
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <History className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>Click "View Logs" on an automation to see its execution history</p>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Create/Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle>
              {editingAutomation ? 'Edit Automation' : 'Create Automation'}
            </DialogTitle>
            <DialogDescription>
              Configure triggers, conditions, and actions for your automation
            </DialogDescription>
          </DialogHeader>

          <ScrollArea className="flex-1 pr-4">
            <div className="space-y-6 py-4">
              {/* Basic Info */}
              <div className="space-y-4">
                <div>
                  <Label htmlFor="name">Name *</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData((p) => ({ ...p, name: e.target.value }))}
                    placeholder="e.g., Welcome Email Sequence"
                  />
                </div>
                <div>
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    value={formData.description}
                    onChange={(e) => setFormData((p) => ({ ...p, description: e.target.value }))}
                    placeholder="Describe what this automation does..."
                    rows={2}
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Switch
                    id="active"
                    checked={formData.is_active}
                    onCheckedChange={(checked) => setFormData((p) => ({ ...p, is_active: checked }))}
                  />
                  <Label htmlFor="active">Active</Label>
                </div>
              </div>

              <Separator />

              {/* Triggers */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-medium">Triggers</h3>
                    <p className="text-sm text-muted-foreground">
                      When should this automation run?
                    </p>
                  </div>
                </div>

                {formData.triggers.length > 0 && (
                  <div className="space-y-2">
                    {formData.triggers.map((trigger, index) => (
                      <div
                        key={index}
                        className="flex items-center gap-2 p-3 bg-muted rounded-lg"
                      >
                        <Zap className="h-4 w-4 text-primary" />
                        <span className="flex-1">{trigger.type.replace(/_/g, ' ')}</span>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeTrigger(index)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                <Accordion type="single" collapsible className="w-full">
                  {Object.entries(TRIGGER_CATEGORIES).map(([key, category]) => (
                    <AccordionItem key={key} value={key}>
                      <AccordionTrigger className="hover:no-underline">
                        <div className="flex items-center gap-2">
                          <category.icon className="h-4 w-4" />
                          {category.label}
                        </div>
                      </AccordionTrigger>
                      <AccordionContent>
                        <div className="grid grid-cols-2 gap-2 pt-2">
                          {category.triggers.map((trigger) => (
                            <Button
                              key={trigger.type}
                              variant="outline"
                              size="sm"
                              className="justify-start"
                              onClick={() => addTrigger(trigger.type)}
                              disabled={formData.triggers.some((t) => t.type === trigger.type)}
                            >
                              <Plus className="h-3 w-3 mr-2" />
                              {trigger.label}
                            </Button>
                          ))}
                        </div>
                      </AccordionContent>
                    </AccordionItem>
                  ))}
                </Accordion>
              </div>

              <Separator />

              {/* Conditions */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-medium">Conditions (Optional)</h3>
                    <p className="text-sm text-muted-foreground">
                      Only run when these conditions are met
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Label className="text-sm">Match:</Label>
                    <Select
                      value={formData.condition_logic}
                      onValueChange={(v) =>
                        setFormData((p) => ({ ...p, condition_logic: v as 'and' | 'or' }))
                      }
                    >
                      <SelectTrigger className="w-24">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="and">All</SelectItem>
                        <SelectItem value="or">Any</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {formData.conditions.map((condition, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      placeholder="Field (e.g., contact.status)"
                      value={condition.field}
                      onChange={(e) => updateCondition(index, { field: e.target.value })}
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
                      placeholder="Value"
                      value={condition.value}
                      onChange={(e) => updateCondition(index, { value: e.target.value })}
                      className="flex-1"
                    />
                    <Button variant="ghost" size="sm" onClick={() => removeCondition(index)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}

                <Button variant="outline" size="sm" onClick={addCondition}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add Condition
                </Button>
              </div>

              <Separator />

              {/* Actions */}
              <div className="space-y-4">
                <div>
                  <h3 className="text-lg font-medium">Actions</h3>
                  <p className="text-sm text-muted-foreground">
                    What should happen when triggered?
                  </p>
                </div>

                {formData.actions.map((action, index) => (
                  <ActionEditor
                    key={index}
                    action={action}
                    onUpdate={(params) => updateAction(index, params)}
                    onRemove={() => removeAction(index)}
                  />
                ))}

                <div className="flex flex-wrap gap-2">
                  {ACTION_TYPES.map((actionType) => (
                    <Button
                      key={actionType.type}
                      variant="outline"
                      size="sm"
                      onClick={() => addAction(actionType.type)}
                    >
                      <actionType.icon className="h-4 w-4 mr-2" />
                      {actionType.label}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          </ScrollArea>

          <DialogFooter className="mt-4">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave}>
              {editingAutomation ? 'Update' : 'Create'} Automation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

// ============================================
// SUB-COMPONENTS
// ============================================

const AutomationCard: React.FC<{
  automation: Automation;
  onEdit: () => void;
  onToggle: () => void;
  onDelete: () => void;
  onViewLogs: () => void;
}> = ({ automation, onEdit, onToggle, onDelete, onViewLogs }) => {
  const triggerLabel = automation.triggers.length > 0
    ? automation.triggers.map((t) => t.type.replace(/_/g, ' ')).join(', ')
    : 'No triggers';

  const actionCount = automation.actions.length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2 text-lg">
              {automation.name}
              <Badge variant={automation.is_active ? 'default' : 'secondary'}>
                {automation.is_active ? 'Active' : 'Inactive'}
              </Badge>
            </CardTitle>
            {automation.description && (
              <CardDescription>{automation.description}</CardDescription>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={onViewLogs}>
              <History className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={onToggle}>
              {automation.is_active ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="sm" onClick={onEdit}>
              <Edit className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="sm" onClick={onDelete}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-1">
            <Zap className="h-4 w-4" />
            <span className="capitalize">{triggerLabel}</span>
          </div>
          <div className="flex items-center gap-1">
            <ArrowRight className="h-4 w-4" />
            <span>{actionCount} action{actionCount !== 1 ? 's' : ''}</span>
          </div>
          {automation.conditions.length > 0 && (
            <div className="flex items-center gap-1">
              <AlertCircle className="h-4 w-4" />
              <span>{automation.conditions.length} condition{automation.conditions.length !== 1 ? 's' : ''}</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};

const ActionEditor: React.FC<{
  action: Action;
  onUpdate: (params: Record<string, any>) => void;
  onRemove: () => void;
}> = ({ action, onUpdate, onRemove }) => {
  const actionInfo = ACTION_TYPES.find((a) => a.type === action.type);
  const Icon = actionInfo?.icon || Zap;

  const updateParam = (key: string, value: any) => {
    onUpdate({ ...action.params, [key]: value });
  };

  return (
    <Card className="bg-muted/50">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon className="h-4 w-4 text-primary" />
            <span className="font-medium">{actionInfo?.label || action.type}</span>
          </div>
          <Button variant="ghost" size="sm" onClick={onRemove}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {action.type === 'send_email' && (
          <>
            <div>
              <Label className="text-xs">Recipient Type</Label>
              <Select
                value={action.params.recipient_type || 'contact'}
                onValueChange={(v) => updateParam('recipient_type', v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="contact">Contact/Homeowner</SelectItem>
                  <SelectItem value="sales_rep">Sales Rep</SelectItem>
                  <SelectItem value="project_manager">Project Manager</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Subject</Label>
              <Input
                value={action.params.subject || ''}
                onChange={(e) => updateParam('subject', e.target.value)}
                placeholder="Email subject..."
              />
            </div>
            <div>
              <Label className="text-xs">Body (supports &#123;&#123;tags&#125;&#125;)</Label>
              <Textarea
                value={action.params.body || ''}
                onChange={(e) => updateParam('body', e.target.value)}
                placeholder="Email body..."
                rows={3}
              />
            </div>
          </>
        )}

        {action.type === 'send_sms' && (
          <>
            <div>
              <Label className="text-xs">Recipient Type</Label>
              <Select
                value={action.params.recipient_type || 'contact'}
                onValueChange={(v) => updateParam('recipient_type', v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="contact">Contact/Homeowner</SelectItem>
                  <SelectItem value="sales_rep">Sales Rep</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Message (supports &#123;&#123;tags&#125;&#125;)</Label>
              <Textarea
                value={action.params.message || ''}
                onChange={(e) => updateParam('message', e.target.value)}
                placeholder="SMS message..."
                rows={2}
              />
            </div>
          </>
        )}

        {action.type === 'assign_task' && (
          <>
            <div>
              <Label className="text-xs">Task Title</Label>
              <Input
                value={action.params.title || ''}
                onChange={(e) => updateParam('title', e.target.value)}
                placeholder="Task title..."
              />
            </div>
            <div>
              <Label className="text-xs">Description</Label>
              <Textarea
                value={action.params.description || ''}
                onChange={(e) => updateParam('description', e.target.value)}
                placeholder="Task description..."
                rows={2}
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Due In (hours)</Label>
                <Input
                  type="number"
                  value={action.params.due_date_offset || 24}
                  onChange={(e) => updateParam('due_date_offset', parseInt(e.target.value))}
                />
              </div>
              <div>
                <Label className="text-xs">Priority</Label>
                <Select
                  value={action.params.priority || 'medium'}
                  onValueChange={(v) => updateParam('priority', v)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">Low</SelectItem>
                    <SelectItem value="medium">Medium</SelectItem>
                    <SelectItem value="high">High</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs">Assign To</Label>
              <Select
                value={action.params.assignee_type || 'sales_rep'}
                onValueChange={(v) => updateParam('assignee_type', v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sales_rep">Sales Rep</SelectItem>
                  <SelectItem value="project_manager">Project Manager</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </>
        )}

        {action.type === 'change_status' && (
          <>
            <div>
              <Label className="text-xs">Entity Type</Label>
              <Select
                value={action.params.entity_type || 'contact'}
                onValueChange={(v) => updateParam('entity_type', v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="contact">Contact/Lead</SelectItem>
                  <SelectItem value="job">Job</SelectItem>
                  <SelectItem value="project">Project</SelectItem>
                  <SelectItem value="pipeline_entry">Pipeline Entry</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">New Status</Label>
              <Input
                value={action.params.new_status || ''}
                onChange={(e) => updateParam('new_status', e.target.value)}
                placeholder="New status value..."
              />
            </div>
          </>
        )}

        {action.type === 'webhook' && (
          <>
            <div>
              <Label className="text-xs">Webhook URL</Label>
              <Input
                value={action.params.url || ''}
                onChange={(e) => updateParam('url', e.target.value)}
                placeholder="https://..."
              />
            </div>
            <div>
              <Label className="text-xs">Method</Label>
              <Select
                value={action.params.method || 'POST'}
                onValueChange={(v) => updateParam('method', v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="POST">POST</SelectItem>
                  <SelectItem value="PUT">PUT</SelectItem>
                  <SelectItem value="PATCH">PATCH</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </>
        )}

        {action.type === 'push_doc' && (
          <>
            <div>
              <Label className="text-xs">Template ID</Label>
              <Input
                value={action.params.template_id || ''}
                onChange={(e) => updateParam('template_id', e.target.value)}
                placeholder="Document template ID..."
              />
            </div>
            <div>
              <Label className="text-xs">Send To</Label>
              <Select
                value={action.params.recipient_type || 'contact'}
                onValueChange={(v) => updateParam('recipient_type', v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="contact">Contact/Homeowner</SelectItem>
                  <SelectItem value="sales_rep">Sales Rep</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </>
        )}

        {action.type === 'create_payment_link' && (
          <>
            <div>
              <Label className="text-xs">Product Name</Label>
              <Input
                value={action.params.product_name || ''}
                onChange={(e) => updateParam('product_name', e.target.value)}
                placeholder="Payment description..."
              />
            </div>
            <div>
              <Label className="text-xs">Send To</Label>
              <Select
                value={action.params.recipient_type || 'contact'}
                onValueChange={(v) => updateParam('recipient_type', v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="contact">Contact/Homeowner</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
};

const LogsTable: React.FC<{ logs: AutomationLog[]; loading: boolean }> = ({ logs, loading }) => {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (logs.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <History className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p>No execution logs yet</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-[400px]">
      <div className="space-y-2">
        {logs.map((log) => (
          <div key={log.id} className="flex items-start gap-3 p-3 bg-muted/50 rounded-lg">
            {log.outcome === 'success' ? (
              <CheckCircle className="h-5 w-5 text-success mt-0.5 shrink-0" />
            ) : log.outcome === 'error' ? (
              <XCircle className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
            ) : (
              <AlertCircle className="h-5 w-5 text-warning mt-0.5 shrink-0" />
            )}
            <div className="flex-1 space-y-1 min-w-0">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="capitalize">
                  {log.event?.replace(/_/g, ' ')}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {new Date(log.fired_at).toLocaleString()}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">{log.cause}</p>
              {log.result && (
                <pre className="text-xs bg-background p-2 rounded overflow-auto max-h-24">
                  {JSON.stringify(log.result, null, 2)}
                </pre>
              )}
            </div>
          </div>
        ))}
      </div>
    </ScrollArea>
  );
};

export default EnhancedAutomationManager;
