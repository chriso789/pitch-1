import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Plus, Edit, Trash2, Mail, Eye, Copy, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { EmailTemplateEditor } from "./EmailTemplateEditor";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface EmailTemplate {
  id: string;
  name: string;
  template_type: string;
  subject: string;
  html_body: string;
  variables: string[];
  is_active: boolean;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

const TEMPLATE_TYPE_CONFIG: Record<string, { label: string; color: string; icon: string }> = {
  onboarding: { label: "Onboarding", color: "bg-emerald-500", icon: "🎉" },
  announcement: { label: "Announcement", color: "bg-blue-500", icon: "📢" },
  followup: { label: "Follow-up", color: "bg-purple-500", icon: "📩" },
  reminder: { label: "Reminder", color: "bg-amber-500", icon: "⏰" },
  feature: { label: "Feature", color: "bg-indigo-500", icon: "🚀" },
  maintenance: { label: "Maintenance", color: "bg-slate-500", icon: "🔧" },
  urgent: { label: "Urgent", color: "bg-red-500", icon: "⚠️" },
  custom: { label: "Custom", color: "bg-gray-500", icon: "✉️" },
};

export function EmailTemplateManager() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editingTemplate, setEditingTemplate] = useState<EmailTemplate | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [previewTemplate, setPreviewTemplate] = useState<EmailTemplate | null>(null);

  const { data: templates, isLoading } = useQuery({
    queryKey: ["email-templates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_templates")
        .select("*")
        .order("template_type", { ascending: true })
        .order("is_default", { ascending: false });
      
      if (error) throw error;
      return data as EmailTemplate[];
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("email_templates")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["email-templates"] });
      toast({ title: "Template deleted" });
      setDeleteConfirm(null);
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const duplicateMutation = useMutation({
    mutationFn: async (template: EmailTemplate) => {
      const { error } = await supabase
        .from("email_templates")
        .insert({
          name: `${template.name} (Copy)`,
          template_type: template.template_type,
          subject: template.subject,
          html_body: template.html_body,
          variables: template.variables,
          is_active: true,
          is_default: false,
        });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["email-templates"] });
      toast({ title: "Template duplicated" });
    },
  });

  const groupedTemplates = templates?.reduce((acc, template) => {
    const type = template.template_type;
    if (!acc[type]) acc[type] = [];
    acc[type].push(template);
    return acc;
  }, {} as Record<string, EmailTemplate[]>);

  if (isCreating || editingTemplate) {
    return (
      <EmailTemplateEditor
        template={editingTemplate}
        onSave={() => {
          setEditingTemplate(null);
          setIsCreating(false);
          queryClient.invalidateQueries({ queryKey: ["email-templates"] });
        }}
        onCancel={() => {
          setEditingTemplate(null);
          setIsCreating(false);
        }}
      />
    );
  }

  if (previewTemplate) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Preview: {previewTemplate.name}</h3>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setEditingTemplate(previewTemplate)}>
              <Edit className="h-4 w-4 mr-2" />
              Edit Template
            </Button>
            <Button variant="ghost" onClick={() => setPreviewTemplate(null)}>
              Back to List
            </Button>
          </div>
        </div>
        
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Subject Line</CardDescription>
            <CardTitle className="text-base">{previewTemplate.subject}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="border rounded-lg overflow-hidden bg-muted/30">
              <iframe
                srcDoc={previewTemplate.html_body
                  .replace(/\{\{first_name\}\}/g, "John")
                  .replace(/\{\{company_name\}\}/g, "ABC Roofing")
                  .replace(/\{\{login_url\}\}/g, "https://pitch-crm.ai/login")
                  .replace(/\{\{feature_name\}\}/g, "AI Measurements")
                  .replace(/\{\{message\}\}/g, "This is a sample message content.")
                  .replace(/\{\{action_url\}\}/g, "https://pitch-crm.ai")
                  .replace(/\{\{maintenance_date\}\}/g, "December 15, 2025 at 2:00 AM EST")
                  .replace(/\{\{alert_title\}\}/g, "Important Update")}
                className="w-full h-[600px] border-0"
                title="Email Preview"
              />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Email Templates</h3>
          <p className="text-sm text-muted-foreground">
            Manage and customize email templates for all communications
          </p>
        </div>
        <Button onClick={() => setIsCreating(true)}>
          <Plus className="h-4 w-4 mr-2" />
          Create Template
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(groupedTemplates || {}).map(([type, typeTemplates]) => {
            const config = TEMPLATE_TYPE_CONFIG[type] || TEMPLATE_TYPE_CONFIG.custom;
            return (
              <div key={type} className="space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{config.icon}</span>
                  <h4 className="font-medium">{config.label} Templates</h4>
                  <Badge variant="secondary" className="ml-auto">
                    {typeTemplates.length}
                  </Badge>
                </div>
                
                <div className="grid gap-3">
                  {typeTemplates.map((template) => (
                    <Card key={template.id} className="hover:shadow-md transition-shadow">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <h5 className="font-medium truncate">{template.name}</h5>
                              {template.is_default && (
                                <Badge variant="outline" className="text-xs">Default</Badge>
                              )}
                              {!template.is_active && (
                                <Badge variant="secondary" className="text-xs">Inactive</Badge>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground truncate">
                              {template.subject}
                            </p>
                            <div className="flex items-center gap-2 mt-2">
                              <Mail className="h-3 w-3 text-muted-foreground" />
                              <span className="text-xs text-muted-foreground">
                                Variables: {(template.variables as string[])?.join(", ") || "None"}
                              </span>
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setPreviewTemplate(template)}
                              title="Preview"
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => setEditingTemplate(template)}
                              title="Edit"
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => duplicateMutation.mutate(template)}
                              title="Duplicate"
                            >
                              <Copy className="h-4 w-4" />
                            </Button>
                            {!template.is_default && (
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setDeleteConfirm(template.id)}
                                title="Delete"
                                className="text-destructive hover:text-destructive"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <AlertDialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Template</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this template? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteConfirm && deleteMutation.mutate(deleteConfirm)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
