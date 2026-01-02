import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, Edit, Trash2, Mail, MessageCircle, Phone, Copy } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/components/ui/use-toast';

interface MessageTemplate {
  id: string;
  name: string;
  template_type: string;
  subject: string;
  content: string;
  variables: any; // Changed from string[] to any to handle Json type
  category: string;
  is_system_template: boolean;
  usage_count: number;
  created_at: string;
}

export const MessageTemplates = () => {
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<MessageTemplate | null>(null);
  const { toast } = useToast();

  const [formData, setFormData] = useState({
    name: '',
    template_type: 'email',
    subject: '',
    content: '',
    category: 'welcome',
    variables: []
  });

  useEffect(() => {
    fetchTemplates();
  }, []);

  const fetchTemplates = async () => {
    try {
      const { data, error } = await supabase
        .from('message_templates')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setTemplates(data || []);
    } catch (error) {
      console.error('Error fetching templates:', error);
      toast({
        title: "Error",
        description: "Failed to fetch message templates",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      const payload = {
        ...formData,
        tenant_id: (await supabase.auth.getUser()).data.user?.user_metadata?.tenant_id
      };

      let result;
      if (editingTemplate) {
        result = await supabase
          .from('message_templates')
          .update(payload)
          .eq('id', editingTemplate.id);
      } else {
        result = await supabase
          .from('message_templates')
          .insert(payload);
      }

      if (result.error) throw result.error;

      toast({
        title: "Success",
        description: `Template ${editingTemplate ? 'updated' : 'created'} successfully`,
      });

      setIsDialogOpen(false);
      resetForm();
      fetchTemplates();
    } catch (error) {
      console.error('Error saving template:', error);
      toast({
        title: "Error",
        description: "Failed to save template",
        variant: "destructive",
      });
    }
  };

  const handleEdit = (template: MessageTemplate) => {
    setEditingTemplate(template);
    setFormData({
      name: template.name,
      template_type: template.template_type,
      subject: template.subject || '',
      content: template.content,
      category: template.category || 'welcome',
      variables: template.variables || []
    });
    setIsDialogOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this template?')) return;

    try {
      const { error } = await supabase
        .from('message_templates')
        .delete()
        .eq('id', id);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Template deleted successfully",
      });

      fetchTemplates();
    } catch (error) {
      console.error('Error deleting template:', error);
      toast({
        title: "Error",
        description: "Failed to delete template",
        variant: "destructive",
      });
    }
  };

  const handleDuplicate = async (template: MessageTemplate) => {
    try {
      const payload = {
        name: `${template.name} (Copy)`,
        template_type: template.template_type,
        subject: template.subject,
        content: template.content,
        variables: template.variables,
        category: template.category,
        tenant_id: (await supabase.auth.getUser()).data.user?.user_metadata?.tenant_id
      };

      const { error } = await supabase
        .from('message_templates')
        .insert(payload);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Template duplicated successfully",
      });

      fetchTemplates();
    } catch (error) {
      console.error('Error duplicating template:', error);
      toast({
        title: "Error",
        description: "Failed to duplicate template",
        variant: "destructive",
      });
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      template_type: 'email',
      subject: '',
      content: '',
      category: 'welcome',
      variables: []
    });
    setEditingTemplate(null);
  };

  const getTemplateTypeIcon = (type: string) => {
    switch (type) {
      case 'email': return <Mail className="h-4 w-4" />;
      case 'sms': return <MessageCircle className="h-4 w-4" />;
      case 'call_script': return <Phone className="h-4 w-4" />;
      default: return <Mail className="h-4 w-4" />;
    }
  };

  const getTemplateTypeBadgeVariant = (type: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      email: "default",
      sms: "secondary",
      call_script: "outline"
    };
    return variants[type] || "outline";
  };

  const getCategoryBadgeVariant = (category: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      welcome: "default",
      follow_up: "secondary",
      reminder: "outline",
      promotion: "destructive"
    };
    return variants[category] || "outline";
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 bg-muted animate-pulse rounded" />
        <div className="h-64 bg-muted animate-pulse rounded" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Message Templates</CardTitle>
              <CardDescription>Manage reusable email, SMS, and call script templates</CardDescription>
            </div>
            <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
              <DialogTrigger asChild>
                <Button onClick={resetForm}>
                  <Plus className="h-4 w-4 mr-2" />
                  New Template
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-2xl">
                <DialogHeader>
                  <DialogTitle>
                    {editingTemplate ? 'Edit Template' : 'Create New Template'}
                  </DialogTitle>
                  <DialogDescription>
                    Create reusable message templates for your nurturing campaigns
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="name">Template Name</Label>
                      <Input
                        id="name"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        placeholder="e.g., Welcome Email Template"
                        required
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="template_type">Type</Label>
                      <Select
                        value={formData.template_type}
                        onValueChange={(value) => setFormData({ ...formData, template_type: value })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="email">Email</SelectItem>
                          <SelectItem value="sms">SMS</SelectItem>
                          <SelectItem value="call_script">Call Script</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="category">Category</Label>
                      <Select
                        value={formData.category}
                        onValueChange={(value) => setFormData({ ...formData, category: value })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="welcome">Welcome</SelectItem>
                          <SelectItem value="follow_up">Follow Up</SelectItem>
                          <SelectItem value="reminder">Reminder</SelectItem>
                          <SelectItem value="promotion">Promotion</SelectItem>
                          <SelectItem value="proposal_followup">Proposal Follow-up</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {formData.template_type === 'email' && (
                      <div className="space-y-2">
                        <Label htmlFor="subject">Subject Line</Label>
                        <Input
                          id="subject"
                          value={formData.subject}
                          onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                          placeholder="Email subject line"
                        />
                      </div>
                    )}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="content">Content</Label>
                    <Textarea
                      id="content"
                      value={formData.content}
                      onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                      placeholder="Enter your message content here..."
                      rows={8}
                      required
                    />
                    <p className="text-xs text-muted-foreground">
                      Available variables: {`{{first_name}}`}, {`{{last_name}}`}, {`{{customer_name}}`}, {`{{property_address}}`}, {`{{estimate_total}}`}, {`{{estimate_number}}`}, {`{{selected_tier}}`}, {`{{company_name}}`}, {`{{rep_name}}`}, {`{{rep_phone}}`}, {`{{proposal_link}}`}
                    </p>
                  </div>

                  <DialogFooter>
                    <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button type="submit">
                      {editingTemplate ? 'Update' : 'Create'}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Usage</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {templates.map((template) => (
                <TableRow key={template.id}>
                  <TableCell>
                    <div className="flex items-center space-x-2">
                      {getTemplateTypeIcon(template.template_type)}
                      <div>
                        <div className="font-medium">{template.name}</div>
                        {template.subject && (
                          <div className="text-sm text-muted-foreground">{template.subject}</div>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={getTemplateTypeBadgeVariant(template.template_type)}>
                      {template.template_type}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={getCategoryBadgeVariant(template.category || 'welcome')}>
                      {template.category || 'welcome'}
                    </Badge>
                  </TableCell>
                  <TableCell>{template.usage_count || 0}</TableCell>
                  <TableCell>{new Date(template.created_at).toLocaleDateString()}</TableCell>
                  <TableCell>
                    <div className="flex items-center space-x-1">
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => handleEdit(template)}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => handleDuplicate(template)}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                      {!template.is_system_template && (
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          onClick={() => handleDelete(template.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          
          {templates.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              No message templates created yet. Create your first template to get started.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};