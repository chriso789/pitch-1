import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ArrowLeft, Save, Eye, Code, Smartphone, Monitor, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface EmailTemplate {
  id?: string;
  name: string;
  template_type: string;
  subject: string;
  html_body: string;
  variables: string[];
  is_active: boolean;
  is_default: boolean;
}

interface EmailTemplateEditorProps {
  template: EmailTemplate | null;
  onSave: () => void;
  onCancel: () => void;
}

const TEMPLATE_TYPES = [
  { value: "onboarding", label: "Onboarding" },
  { value: "announcement", label: "Announcement" },
  { value: "feature", label: "Feature Update" },
  { value: "maintenance", label: "Maintenance Notice" },
  { value: "urgent", label: "Urgent Alert" },
  { value: "custom", label: "Custom" },
];

const AVAILABLE_VARIABLES = [
  { key: "first_name", label: "First Name", sample: "John" },
  { key: "company_name", label: "Company Name", sample: "ABC Roofing" },
  { key: "login_url", label: "Login URL", sample: "https://pitch-crm.ai/login" },
  { key: "feature_name", label: "Feature Name", sample: "AI Measurements" },
  { key: "message", label: "Message Content", sample: "This is a sample message." },
  { key: "action_url", label: "Action URL", sample: "https://pitch-crm.ai" },
  { key: "maintenance_date", label: "Maintenance Date", sample: "December 15, 2025" },
  { key: "alert_title", label: "Alert Title", sample: "Important Update" },
];

const DEFAULT_HTML = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin: 0; padding: 0; font-family: 'Segoe UI', sans-serif; background-color: #f4f4f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f4f4f5; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 16px; overflow: hidden;">
          <tr>
            <td style="background: linear-gradient(135deg, #1e3a5f 0%, #2d5a87 100%); padding: 30px; text-align: center;">
              <h1 style="color: #ffffff; margin: 0; font-size: 24px;">Email Title</h1>
            </td>
          </tr>
          <tr>
            <td style="padding: 30px;">
              <h2 style="color: #1e3a5f; margin: 0 0 15px;">Hi {{first_name}},</h2>
              <p style="color: #475569; line-height: 1.6;">{{message}}</p>
            </td>
          </tr>
          <tr>
            <td style="background-color: #f8fafc; padding: 20px 30px; text-align: center;">
              <p style="color: #94a3b8; margin: 0; font-size: 12px;">© 2025 PITCH CRM</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

export function EmailTemplateEditor({ template, onSave, onCancel }: EmailTemplateEditorProps) {
  const { toast } = useToast();
  const isEditing = !!template?.id;
  
  const [formData, setFormData] = useState<EmailTemplate>({
    name: template?.name || "",
    template_type: template?.template_type || "custom",
    subject: template?.subject || "",
    html_body: template?.html_body || DEFAULT_HTML,
    variables: template?.variables || ["first_name", "company_name"],
    is_active: template?.is_active ?? true,
    is_default: template?.is_default ?? false,
  });

  const [previewMode, setPreviewMode] = useState<"desktop" | "mobile">("desktop");
  const [activeTab, setActiveTab] = useState<"edit" | "preview">("edit");

  const saveMutation = useMutation({
    mutationFn: async (data: EmailTemplate) => {
      if (isEditing && template?.id) {
        const { error } = await supabase
          .from("email_templates")
          .update({
            name: data.name,
            template_type: data.template_type,
            subject: data.subject,
            html_body: data.html_body,
            variables: data.variables,
            is_active: data.is_active,
          })
          .eq("id", template.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("email_templates")
          .insert({
            name: data.name,
            template_type: data.template_type,
            subject: data.subject,
            html_body: data.html_body,
            variables: data.variables,
            is_active: data.is_active,
            is_default: false,
          });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast({ title: isEditing ? "Template updated" : "Template created" });
      onSave();
    },
    onError: (error: any) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const insertVariable = (variable: string) => {
    const textarea = document.getElementById("html-editor") as HTMLTextAreaElement;
    if (textarea) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const text = formData.html_body;
      const newText = text.substring(0, start) + `{{${variable}}}` + text.substring(end);
      setFormData({ ...formData, html_body: newText });
      
      // Add to variables list if not already there
      if (!formData.variables.includes(variable)) {
        setFormData(prev => ({
          ...prev,
          html_body: newText,
          variables: [...prev.variables, variable],
        }));
      }
    }
  };

  const getPreviewHtml = () => {
    let html = formData.html_body;
    AVAILABLE_VARIABLES.forEach(v => {
      html = html.replace(new RegExp(`\\{\\{${v.key}\\}\\}`, 'g'), v.sample);
    });
    return html;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={onCancel}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h3 className="text-lg font-semibold">
              {isEditing ? "Edit Template" : "Create Template"}
            </h3>
            <p className="text-sm text-muted-foreground">
              {isEditing ? `Editing: ${template?.name}` : "Create a new email template"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            onClick={() => saveMutation.mutate(formData)}
            disabled={!formData.name || !formData.subject || saveMutation.isPending}
          >
            <Save className="h-4 w-4 mr-2" />
            {saveMutation.isPending ? "Saving..." : "Save Template"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left: Editor */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Template Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Template Name</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g., Welcome Email"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="type">Template Type</Label>
                  <Select
                    value={formData.template_type}
                    onValueChange={(value) => setFormData({ ...formData, template_type: value })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TEMPLATE_TYPES.map((type) => (
                        <SelectItem key={type.value} value={type.value}>
                          {type.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="subject">Subject Line</Label>
                <Input
                  id="subject"
                  value={formData.subject}
                  onChange={(e) => setFormData({ ...formData, subject: e.target.value })}
                  placeholder="e.g., Welcome to PITCH CRM!"
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Switch
                    id="is_active"
                    checked={formData.is_active}
                    onCheckedChange={(checked) => setFormData({ ...formData, is_active: checked })}
                  />
                  <Label htmlFor="is_active">Active</Label>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Insert Variables</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {AVAILABLE_VARIABLES.map((variable) => (
                  <Button
                    key={variable.key}
                    variant="outline"
                    size="sm"
                    onClick={() => insertVariable(variable.key)}
                    className="text-xs"
                  >
                    <Plus className="h-3 w-3 mr-1" />
                    {`{{${variable.key}}}`}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-3">
                Click a variable to insert it at the cursor position in the HTML editor
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Code className="h-4 w-4" />
                  HTML Editor
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <Textarea
                id="html-editor"
                value={formData.html_body}
                onChange={(e) => setFormData({ ...formData, html_body: e.target.value })}
                className="font-mono text-xs h-[400px] resize-none"
                placeholder="Paste or write your HTML email template here..."
              />
            </CardContent>
          </Card>
        </div>

        {/* Right: Preview */}
        <div className="space-y-4">
          <Card className="h-full">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <Eye className="h-4 w-4" />
                  Live Preview
                </CardTitle>
                <div className="flex items-center gap-1 bg-muted rounded-md p-1">
                  <Button
                    variant={previewMode === "desktop" ? "secondary" : "ghost"}
                    size="sm"
                    onClick={() => setPreviewMode("desktop")}
                    className="h-7 px-2"
                  >
                    <Monitor className="h-4 w-4" />
                  </Button>
                  <Button
                    variant={previewMode === "mobile" ? "secondary" : "ghost"}
                    size="sm"
                    onClick={() => setPreviewMode("mobile")}
                    className="h-7 px-2"
                  >
                    <Smartphone className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="border rounded-lg overflow-hidden bg-muted/30">
                <div className="bg-muted/50 px-3 py-2 border-b text-sm">
                  <span className="text-muted-foreground">Subject:</span>{" "}
                  <span className="font-medium">
                    {formData.subject
                      .replace(/\{\{first_name\}\}/g, "John")
                      .replace(/\{\{company_name\}\}/g, "ABC Roofing")
                      .replace(/\{\{feature_name\}\}/g, "AI Measurements")
                      .replace(/\{\{alert_title\}\}/g, "Important Update")
                      .replace(/\{\{maintenance_date\}\}/g, "December 15, 2025")}
                  </span>
                </div>
                <div
                  className={`transition-all duration-300 mx-auto ${
                    previewMode === "mobile" ? "max-w-[375px]" : "w-full"
                  }`}
                >
                  <iframe
                    srcDoc={getPreviewHtml()}
                    className="w-full h-[500px] border-0"
                    title="Email Preview"
                  />
                </div>
              </div>
              
              <div className="mt-4 p-3 bg-muted/50 rounded-lg">
                <p className="text-xs text-muted-foreground">
                  <strong>Preview Data:</strong> Variables are replaced with sample data for preview.
                  Actual emails will use real recipient data.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
