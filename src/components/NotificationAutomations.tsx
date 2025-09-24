import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { 
  Bell, 
  Plus, 
  Edit, 
  Trash2, 
  Mail, 
  MessageSquare, 
  Smartphone,
  Clock,
  Users,
  Activity,
  Tag,
  Copy,
  Play,
  Pause
} from 'lucide-react';
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface NotificationTemplate {
  id: string;
  name: string;
  description: string;
  template_type: string;
  recipient_type: string;
  subject: string;
  content: string;
  is_active: boolean;
  created_at: string;
}

interface AutomationRule {
  id: string;
  name: string;
  description: string;
  trigger_event: string;
  trigger_conditions: any;
  template_id: string;
  recipient_rules: any;
  delay_minutes: number;
  is_active: boolean;
  execution_count: number;
  template?: NotificationTemplate;
}

interface SmartWord {
  id: string;
  word_key: string;
  display_name: string;
  description: string;
  category: string;
  format_type: string;
  is_system: boolean;
}

export function NotificationAutomations() {
  const [templates, setTemplates] = useState<NotificationTemplate[]>([]);
  const [automations, setAutomations] = useState<AutomationRule[]>([]);
  const [smartWords, setSmartWords] = useState<SmartWord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showTemplateDialog, setShowTemplateDialog] = useState(false);
  const [showAutomationDialog, setShowAutomationDialog] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<NotificationTemplate | null>(null);
  const [editingAutomation, setEditingAutomation] = useState<AutomationRule | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    loadData();
    initializeSmartWords();
  }, []);

  const loadData = async () => {
    try {
      // Load templates
      const { data: templatesData, error: templatesError } = await supabase
        .from('notification_templates')
        .select('*')
        .order('created_at', { ascending: false });

      if (templatesError) throw templatesError;

      // Load automation rules with templates
      const { data: automationsData, error: automationsError } = await supabase
        .from('automation_rules')
        .select(`
          *,
          template:notification_templates(*)
        `)
        .order('created_at', { ascending: false });

      if (automationsError) throw automationsError;

      // Load smart words
      const { data: smartWordsData, error: smartWordsError } = await supabase
        .from('smart_word_definitions')
        .select('*')
        .order('category', { ascending: true });

      if (smartWordsError) throw smartWordsError;

      setTemplates(templatesData || []);
      setAutomations(automationsData || []);
      setSmartWords(smartWordsData || []);
    } catch (error) {
      console.error('Error loading automation data:', error);
      toast({
        title: "Error loading data",
        description: "Failed to load automation data. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const initializeSmartWords = async () => {
    try {
      // Get current user's tenant
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('id', user.id)
        .single();

      if (!profile?.tenant_id) return;

      // Check if smart words already exist
      const { data: existingWords } = await supabase
        .from('smart_word_definitions')
        .select('id')
        .limit(1);

      if (existingWords && existingWords.length > 0) {
        return; // Already initialized
      }

      // Initialize default smart words
      const defaultSmartWords = [
        // Customer smart words
        { word_key: 'customer_first_name', display_name: 'Customer First Name', description: 'First name of the customer', data_source: 'contacts', data_field: 'first_name', format_type: 'text', is_system: true, category: 'customer' },
        { word_key: 'customer_last_name', display_name: 'Customer Last Name', description: 'Last name of the customer', data_source: 'contacts', data_field: 'last_name', format_type: 'text', is_system: true, category: 'customer' },
        { word_key: 'customer_email', display_name: 'Customer Email', description: 'Email address of the customer', data_source: 'contacts', data_field: 'email', format_type: 'text', is_system: true, category: 'customer' },
        { word_key: 'customer_phone', display_name: 'Customer Phone', description: 'Phone number of the customer', data_source: 'contacts', data_field: 'phone', format_type: 'phone', is_system: true, category: 'customer' },
        
        // Project smart words
        { word_key: 'project_name', display_name: 'Project Name', description: 'Name of the project', data_source: 'projects', data_field: 'name', format_type: 'text', is_system: true, category: 'project' },
        { word_key: 'project_number', display_name: 'Project Number', description: 'Project number/ID', data_source: 'projects', data_field: 'project_number', format_type: 'text', is_system: true, category: 'project' },
        { word_key: 'project_status', display_name: 'Project Status', description: 'Current status of the project', data_source: 'projects', data_field: 'status', format_type: 'text', is_system: true, category: 'project' },
        
        // Payment smart words
        { word_key: 'payment_amount', display_name: 'Payment Amount', description: 'Amount of the payment', data_source: 'payments', data_field: 'amount', format_type: 'currency', is_system: true, category: 'payment' },
        { word_key: 'payment_status', display_name: 'Payment Status', description: 'Status of the payment', data_source: 'payments', data_field: 'status', format_type: 'text', is_system: true, category: 'payment' },
        
        // Estimate smart words
        { word_key: 'estimate_number', display_name: 'Estimate Number', description: 'Estimate number/ID', data_source: 'estimates', data_field: 'estimate_number', format_type: 'text', is_system: true, category: 'estimate' },
        { word_key: 'estimate_total', display_name: 'Estimate Total', description: 'Total amount of the estimate', data_source: 'estimates', data_field: 'selling_price', format_type: 'currency', is_system: true, category: 'estimate' },
        
        // System smart words
        { word_key: 'current_date', display_name: 'Current Date', description: 'Today\'s date', data_source: 'system', data_field: 'CURRENT_DATE', format_type: 'date', is_system: true, category: 'system' },
        { word_key: 'company_name', display_name: 'Company Name', description: 'Name of the company', data_source: 'profiles', data_field: 'company_name', format_type: 'text', is_system: true, category: 'system' }
      ];

      const wordsToInsert = defaultSmartWords.map(word => ({
        ...word,
        tenant_id: profile.tenant_id
      }));

      const { error } = await supabase
        .from('smart_word_definitions')
        .insert(wordsToInsert);

      if (error) {
        console.error('Error initializing smart words:', error);
      } else {
        loadData(); // Reload to show the new smart words
      }
    } catch (error) {
      console.error('Error initializing smart words:', error);
    }
  };

  const toggleTemplateStatus = async (templateId: string, isActive: boolean) => {
    try {
      const { error } = await supabase
        .from('notification_templates')
        .update({ is_active: isActive })
        .eq('id', templateId);

      if (error) throw error;

      setTemplates(templates.map(t => 
        t.id === templateId ? { ...t, is_active: isActive } : t
      ));

      toast({
        title: isActive ? "Template enabled" : "Template disabled",
        description: `Template has been ${isActive ? 'enabled' : 'disabled'}.`,
      });
    } catch (error) {
      console.error('Error updating template status:', error);
      toast({
        title: "Error",
        description: "Failed to update template status.",
        variant: "destructive",
      });
    }
  };

  const toggleAutomationStatus = async (automationId: string, isActive: boolean) => {
    try {
      const { error } = await supabase
        .from('automation_rules')
        .update({ is_active: isActive })
        .eq('id', automationId);

      if (error) throw error;

      setAutomations(automations.map(a => 
        a.id === automationId ? { ...a, is_active: isActive } : a
      ));

      toast({
        title: isActive ? "Automation enabled" : "Automation disabled",
        description: `Automation has been ${isActive ? 'enabled' : 'disabled'}.`,
      });
    } catch (error) {
      console.error('Error updating automation status:', error);
      toast({
        title: "Error",
        description: "Failed to update automation status.",
        variant: "destructive",
      });
    }
  };

  const getTemplateTypeIcon = (type: string) => {
    switch (type) {
      case 'email': return <Mail className="h-4 w-4" />;
      case 'sms': return <Smartphone className="h-4 w-4" />;
      case 'in_app': return <Bell className="h-4 w-4" />;
      default: return <MessageSquare className="h-4 w-4" />;
    }
  };

  const getRecipientTypeColor = (type: string) => {
    switch (type) {
      case 'homeowner': return 'default';
      case 'sales_rep': return 'secondary';
      case 'manager': return 'outline';
      case 'admin': return 'destructive';
      default: return 'outline';
    }
  };

  const copySmartWord = (wordKey: string) => {
    const textToCopy = `{${wordKey}}`;
    navigator.clipboard.writeText(textToCopy);
    toast({
      title: "Smart word copied",
      description: `{${wordKey}} copied to clipboard`,
    });
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64">Loading automation settings...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Notification Automations</h1>
          <p className="text-muted-foreground">Automate notifications with smart words for dynamic content</p>
        </div>
        <div className="flex gap-2">
          <Dialog open={showTemplateDialog} onOpenChange={setShowTemplateDialog}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-2" />
                New Template
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <TemplateForm 
                template={editingTemplate}
                smartWords={smartWords}
                onSave={(template) => {
                  setTemplates(prev => editingTemplate 
                    ? prev.map(t => t.id === template.id ? template : t)
                    : [...prev, template]
                  );
                  setShowTemplateDialog(false);
                  setEditingTemplate(null);
                }}
                onCancel={() => {
                  setShowTemplateDialog(false);
                  setEditingTemplate(null);
                }}
              />
            </DialogContent>
          </Dialog>
          
          <Dialog open={showAutomationDialog} onOpenChange={setShowAutomationDialog}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Plus className="h-4 w-4 mr-2" />
                New Automation
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <AutomationForm 
                automation={editingAutomation}
                templates={templates}
                onSave={(automation) => {
                  setAutomations(prev => editingAutomation 
                    ? prev.map(a => a.id === automation.id ? automation : a)
                    : [...prev, automation]
                  );
                  setShowAutomationDialog(false);
                  setEditingAutomation(null);
                }}
                onCancel={() => {
                  setShowAutomationDialog(false);
                  setEditingAutomation(null);
                }}
              />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Tabs defaultValue="templates" className="w-full">
        <TabsList>
          <TabsTrigger value="templates">Templates</TabsTrigger>
          <TabsTrigger value="automations">Automations</TabsTrigger>
          <TabsTrigger value="smart-words">Smart Words</TabsTrigger>
          <TabsTrigger value="executions">Execution Log</TabsTrigger>
        </TabsList>

        <TabsContent value="templates" className="mt-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {templates.map((template) => (
              <Card key={template.id} className="relative">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {getTemplateTypeIcon(template.template_type)}
                      <CardTitle className="text-lg">{template.name}</CardTitle>
                    </div>
                    <Switch
                      checked={template.is_active}
                      onCheckedChange={(checked) => toggleTemplateStatus(template.id, checked)}
                    />
                  </div>
                  <CardDescription>{template.description}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Badge variant={getRecipientTypeColor(template.recipient_type)}>
                      {template.recipient_type}
                    </Badge>
                    <Badge variant="outline">
                      {template.template_type.toUpperCase()}
                    </Badge>
                  </div>
                  
                  {template.subject && (
                    <div>
                      <Label className="text-xs text-muted-foreground">Subject</Label>
                      <p className="text-sm font-medium">{template.subject}</p>
                    </div>
                  )}
                  
                  <div>
                    <Label className="text-xs text-muted-foreground">Content Preview</Label>
                    <p className="text-sm text-muted-foreground line-clamp-3">
                      {template.content}
                    </p>
                  </div>

                  <div className="flex gap-2 pt-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditingTemplate(template);
                        setShowTemplateDialog(true);
                      }}
                    >
                      <Edit className="h-3 w-3 mr-1" />
                      Edit
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="automations" className="mt-6">
          <div className="space-y-4">
            {automations.map((automation) => (
              <Card key={automation.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Activity className="h-5 w-5" />
                      <div>
                        <CardTitle>{automation.name}</CardTitle>
                        <CardDescription>{automation.description}</CardDescription>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant="outline">
                        {automation.execution_count} executions
                      </Badge>
                      <Switch
                        checked={automation.is_active}
                        onCheckedChange={(checked) => toggleAutomationStatus(automation.id, checked)}
                      />
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <Label className="text-xs text-muted-foreground">Trigger Event</Label>
                      <p className="font-medium">{automation.trigger_event.replace('_', ' ').toUpperCase()}</p>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Template</Label>
                      <p className="font-medium">{automation.template?.name || 'No template'}</p>
                    </div>
                    <div>
                      <Label className="text-xs text-muted-foreground">Delay</Label>
                      <p className="font-medium">
                        {automation.delay_minutes === 0 ? 'Immediate' : `${automation.delay_minutes} minutes`}
                      </p>
                    </div>
                  </div>
                  
                  <div className="flex gap-2 mt-4">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditingAutomation(automation);
                        setShowAutomationDialog(true);
                      }}
                    >
                      <Edit className="h-3 w-3 mr-1" />
                      Edit
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="smart-words" className="mt-6">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Available Smart Words</CardTitle>
                <CardDescription>
                  Use these smart words in your templates to insert dynamic content. Click to copy.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {['customer', 'project', 'payment', 'estimate', 'system'].map(category => {
                  const categoryWords = smartWords.filter(word => word.category === category);
                  if (categoryWords.length === 0) return null;
                  
                  return (
                    <div key={category} className="mb-6">
                      <h4 className="font-semibold mb-3 text-sm uppercase tracking-wide text-muted-foreground">
                        {category} Smart Words
                      </h4>
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                        {categoryWords.map((word) => (
                          <Card 
                            key={word.id} 
                            className="p-3 cursor-pointer hover:shadow-md transition-shadow"
                            onClick={() => copySmartWord(word.word_key)}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex-1">
                                <div className="flex items-center gap-2">
                                  <code className="text-sm font-mono bg-muted px-2 py-1 rounded">
                                    {`{${word.word_key}}`}
                                  </code>
                                  <Copy className="h-3 w-3 text-muted-foreground" />
                                </div>
                                <p className="text-sm font-medium mt-1">{word.display_name}</p>
                                <p className="text-xs text-muted-foreground">{word.description}</p>
                              </div>
                              <Badge variant="outline" className="text-xs">
                                {word.format_type}
                              </Badge>
                            </div>
                          </Card>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="executions" className="mt-6">
          <ExecutionLog />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// Template Form Component
function TemplateForm({ 
  template, 
  smartWords, 
  onSave, 
  onCancel 
}: { 
  template: NotificationTemplate | null;
  smartWords: SmartWord[];
  onSave: (template: NotificationTemplate) => void;
  onCancel: () => void;
}) {
  const [formData, setFormData] = useState({
    name: template?.name || '',
    description: template?.description || '',
    template_type: template?.template_type || 'email',
    recipient_type: template?.recipient_type || 'homeowner',
    subject: template?.subject || '',
    content: template?.content || ''
  });
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('id', user.id)
        .single();

      if (!profile?.tenant_id) throw new Error('No tenant found');

      if (template) {
        // Update existing template
        const { data, error } = await supabase
          .from('notification_templates')
          .update({
            ...formData,
            updated_at: new Date().toISOString()
          })
          .eq('id', template.id)
          .select()
          .single();

        if (error) throw error;
        onSave(data);
      } else {
        // Create new template
        const { data, error } = await supabase
          .from('notification_templates')
          .insert({
            ...formData,
            tenant_id: profile.tenant_id
          })
          .select()
          .single();

        if (error) throw error;
        onSave(data);
      }

      toast({
        title: template ? "Template updated" : "Template created",
        description: `Template has been ${template ? 'updated' : 'created'} successfully.`,
      });
    } catch (error) {
      console.error('Error saving template:', error);
      toast({
        title: "Error",
        description: "Failed to save template.",
        variant: "destructive",
      });
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>{template ? 'Edit Template' : 'Create New Template'}</DialogTitle>
        <DialogDescription>
          Create notification templates with smart words for dynamic content.
        </DialogDescription>
      </DialogHeader>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="name">Template Name</Label>
          <Input
            id="name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            placeholder="Payment Confirmation"
            required
          />
        </div>
        
        <div>
          <Label htmlFor="template_type">Type</Label>
          <Select value={formData.template_type} onValueChange={(value) => setFormData({ ...formData, template_type: value })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="email">Email</SelectItem>
              <SelectItem value="sms">SMS</SelectItem>
              <SelectItem value="in_app">In-App</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div>
        <Label htmlFor="description">Description</Label>
        <Input
          id="description"
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          placeholder="Sent when payment is completed"
        />
      </div>

      <div>
        <Label htmlFor="recipient_type">Recipient Type</Label>
        <Select value={formData.recipient_type} onValueChange={(value) => setFormData({ ...formData, recipient_type: value })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="homeowner">Homeowner</SelectItem>
            <SelectItem value="sales_rep">Sales Rep</SelectItem>
            <SelectItem value="manager">Manager</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {formData.template_type === 'email' && (
        <div>
          <Label htmlFor="subject">Email Subject</Label>
          <Input
            id="subject"
            value={formData.subject}
            onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
            placeholder="Payment Received - {customer_first_name}"
          />
        </div>
      )}

      <div>
        <Label htmlFor="content">Content</Label>
        <Textarea
          id="content"
          value={formData.content}
          onChange={(e) => setFormData({ ...formData, content: e.target.value })}
          placeholder="Hi {customer_first_name}, your payment of {payment_amount} has been received..."
          rows={6}
          required
        />
        <p className="text-xs text-muted-foreground mt-1">
          Use smart words like {'{customer_first_name}'} for dynamic content
        </p>
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">
          {template ? 'Update Template' : 'Create Template'}
        </Button>
      </div>
    </form>
  );
}

// Automation Form Component
function AutomationForm({ 
  automation, 
  templates, 
  onSave, 
  onCancel 
}: { 
  automation: AutomationRule | null;
  templates: NotificationTemplate[];
  onSave: (automation: AutomationRule) => void;
  onCancel: () => void;
}) {
  const [formData, setFormData] = useState({
    name: automation?.name || '',
    description: automation?.description || '',
    trigger_event: automation?.trigger_event || 'payment_completed',
    template_id: automation?.template_id || '',
    delay_minutes: automation?.delay_minutes || 0,
    recipient_rules: automation?.recipient_rules || {}
  });
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('id', user.id)
        .single();

      if (!profile?.tenant_id) throw new Error('No tenant found');

      if (automation) {
        // Update existing automation
        const { data, error } = await supabase
          .from('automation_rules')
          .update({
            ...formData,
            updated_at: new Date().toISOString()
          })
          .eq('id', automation.id)
          .select()
          .single();

        if (error) throw error;
        onSave(data);
      } else {
        // Create new automation
        const { data, error } = await supabase
          .from('automation_rules')
          .insert({
            ...formData,
            tenant_id: profile.tenant_id
          })
          .select()
          .single();

        if (error) throw error;
        onSave(data);
      }

      toast({
        title: automation ? "Automation updated" : "Automation created",
        description: `Automation has been ${automation ? 'updated' : 'created'} successfully.`,
      });
    } catch (error) {
      console.error('Error saving automation:', error);
      toast({
        title: "Error",
        description: "Failed to save automation.",
        variant: "destructive",
      });
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>{automation ? 'Edit Automation' : 'Create New Automation'}</DialogTitle>
        <DialogDescription>
          Set up automated notifications triggered by system events.
        </DialogDescription>
      </DialogHeader>

      <div>
        <Label htmlFor="name">Automation Name</Label>
        <Input
          id="name"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          placeholder="Payment Completion Notification"
          required
        />
      </div>

      <div>
        <Label htmlFor="description">Description</Label>
        <Input
          id="description"
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          placeholder="Notify homeowner when payment is completed"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label htmlFor="trigger_event">Trigger Event</Label>
          <Select value={formData.trigger_event} onValueChange={(value) => setFormData({ ...formData, trigger_event: value })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="payment_completed">Payment Completed</SelectItem>
              <SelectItem value="project_status_changed">Project Status Changed</SelectItem>
              <SelectItem value="estimate_sent">Estimate Sent</SelectItem>
              <SelectItem value="estimate_approved">Estimate Approved</SelectItem>
              <SelectItem value="material_ordered">Material Ordered</SelectItem>
              <SelectItem value="delivery_scheduled">Delivery Scheduled</SelectItem>
              <SelectItem value="project_started">Project Started</SelectItem>
              <SelectItem value="project_completed">Project Completed</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label htmlFor="delay_minutes">Delay (minutes)</Label>
          <Input
            id="delay_minutes"
            type="number"
            min="0"
            value={formData.delay_minutes}
            onChange={(e) => setFormData({ ...formData, delay_minutes: parseInt(e.target.value) || 0 })}
            placeholder="0"
          />
        </div>
      </div>

      <div>
        <Label htmlFor="template_id">Notification Template</Label>
        <Select value={formData.template_id} onValueChange={(value) => setFormData({ ...formData, template_id: value })}>
          <SelectTrigger>
            <SelectValue placeholder="Select a template" />
          </SelectTrigger>
          <SelectContent>
            {templates.map((template) => (
              <SelectItem key={template.id} value={template.id}>
                {template.name} ({template.template_type})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit">
          {automation ? 'Update Automation' : 'Create Automation'}
        </Button>
      </div>
    </form>
  );
}

// Execution Log Component
function ExecutionLog() {
  const [executions, setExecutions] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadExecutions();
  }, []);

  const loadExecutions = async () => {
    try {
      const { data, error } = await supabase
        .from('notification_executions')
        .select(`
          *,
          automation_rule:automation_rules(name),
          template:notification_templates(name, template_type)
        `)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;
      setExecutions(data || []);
    } catch (error) {
      console.error('Error loading executions:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-32">Loading execution log...</div>;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Execution Log</CardTitle>
        <CardDescription>Recent notification executions and their status</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {executions.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">No executions yet</p>
          ) : (
            executions.map((execution: any) => (
              <div key={execution.id} className="flex items-center justify-between p-3 border rounded-lg">
                <div className="flex items-center gap-3">
                  <Badge variant={execution.status === 'sent' ? 'default' : execution.status === 'failed' ? 'destructive' : 'outline'}>
                    {execution.status}
                  </Badge>
                  <div>
                    <p className="font-medium">{execution.automation_rule?.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {execution.template?.name} • {execution.recipient_email}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm text-muted-foreground">
                    {new Date(execution.created_at).toLocaleDateString()}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {execution.trigger_event.replace('_', ' ')}
                  </p>
                </div>
              </div>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}