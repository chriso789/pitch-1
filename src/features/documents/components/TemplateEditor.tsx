import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Save, Eye, Plus, X, Tag } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";
import { TagPicker } from "./TagPicker";

interface SmartDocTemplate {
  id: string;
  name: string;
  type: string;
  description?: string;
  status: string;
  is_homeowner_visible: boolean;
  created_at: string;
  // Note: Template content stored separately
  default_context?: string;
  folder_id?: string;
  smartdoc_folders?: {
    name: string;
  };
}

interface SmartDocFolder {
  id: string;
  name: string;
}

interface TemplateEditorProps {
  template: SmartDocTemplate | null;
  folders: SmartDocFolder[];
  onClose: () => void;
}

export const TemplateEditor: React.FC<TemplateEditorProps> = ({
  template,
  folders,
  onClose
}) => {
  const [formData, setFormData] = useState({
    name: "",
    type: "document",
    description: "",
    content: "",
    default_context: "PROJECT",
    folder_id: "",
    status: "draft",
    is_homeowner_visible: false,
  });
  const [showTagPicker, setShowTagPicker] = useState(false);
  const [cursorPosition, setCursorPosition] = useState(0);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (template) {
      setFormData({
        name: template.name || "",
        type: template.type || "document",
        description: template.description || "",
        content: "", // Template content will be managed separately
        default_context: template.default_context || "PROJECT",
        folder_id: template.folder_id || "",
        status: template.status || "draft",
        is_homeowner_visible: template.is_homeowner_visible || false,
      });
    }
  }, [template]);

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast({
        title: "Error",
        description: "Template name is required",
        variant: "destructive",
      });
      return;
    }

    try {
      setSaving(true);
      
      const templateData = {
        name: formData.name.trim(),
        type: formData.type as "DOCUMENT" | "EMAIL" | "PRINT", 
        description: formData.description.trim() || null,
        default_context: formData.default_context as "CONTACT" | "LEAD" | "PROJECT" | "ESTIMATE" | "INVOICE",
        folder_id: formData.folder_id || null,
        status: formData.status.toUpperCase() as "DRAFT" | "PUBLISHED" | "ARCHIVED",
        is_homeowner_visible: formData.is_homeowner_visible,
        tenant_id: "14de934e-7964-4afd-940a-620d2ace125d", // Fixed tenant ID from the network requests
      };

      let error;
      if (template) {
        // Update existing template
        const { error: updateError } = await supabase
          .from('smartdoc_templates')
          .update(templateData)
          .eq('id', template.id);
        error = updateError;
      } else {
        // Create new template
        const { error: insertError } = await supabase
          .from('smartdoc_templates')
          .insert(templateData);
        error = insertError;
      }

      if (error) throw error;

      toast({
        title: "Success",
        description: `Template ${template ? 'updated' : 'created'} successfully`,
      });
      
      onClose();
    } catch (error) {
      console.error('Error saving template:', error);
      toast({
        title: "Error",
        description: `Failed to ${template ? 'update' : 'create'} template`,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const insertTag = (tag: string) => {
    const textarea = document.getElementById('content-textarea') as HTMLTextAreaElement;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const newContent = formData.content.substring(0, start) + 
                      `{{${tag}}}` + 
                      formData.content.substring(end);
    
    setFormData(prev => ({ ...prev, content: newContent }));
    
    // Set cursor position after the inserted tag
    setTimeout(() => {
      textarea.focus();
      textarea.setSelectionRange(start + tag.length + 4, start + tag.length + 4);
    }, 0);
  };

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setFormData(prev => ({ ...prev, content: e.target.value }));
    setCursorPosition(e.target.selectionStart);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Button variant="ghost" onClick={onClose}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Library
          </Button>
          <div>
            <h1 className="text-2xl font-bold">
              {template ? 'Edit Template' : 'Create New Template'}
            </h1>
            <p className="text-muted-foreground">
              {template ? `Editing: ${template.name}` : 'Create a new smart document template'}
            </p>
          </div>
        </div>
        <div className="flex items-center space-x-2">
          <Button variant="outline">
            <Eye className="mr-2 h-4 w-4" />
            Preview
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            <Save className="mr-2 h-4 w-4" />
            {saving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Template Properties */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Template Properties</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="name">Template Name</Label>
              <Input
                id="name"
                value={formData.name}
                onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                placeholder="e.g., Roofing Proposal"
              />
            </div>

            <div>
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={formData.description}
                onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Brief description of this template"
                rows={3}
              />
            </div>

            <div>
              <Label htmlFor="type">Document Type</Label>
              <Select value={formData.type} onValueChange={(value) => setFormData(prev => ({ ...prev, type: value }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select document type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="document">Document</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="print">Print</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="folder">Folder</Label>
              <Select value={formData.folder_id} onValueChange={(value) => setFormData(prev => ({ ...prev, folder_id: value }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select folder" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">No Folder</SelectItem>
                  {folders.map(folder => (
                    <SelectItem key={folder.id} value={folder.id}>
                      {folder.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="context">Default Context</Label>
              <Select value={formData.default_context} onValueChange={(value) => setFormData(prev => ({ ...prev, default_context: value }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select context" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="PROJECT">Project</SelectItem>
                  <SelectItem value="ESTIMATE">Estimate</SelectItem>
                  <SelectItem value="CONTACT">Contact</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label htmlFor="status">Status</Label>
              <Select value={formData.status} onValueChange={(value) => setFormData(prev => ({ ...prev, status: value }))}>
                <SelectTrigger>
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="published">Published</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center space-x-2">
              <Switch
                id="homeowner-visible"
                checked={formData.is_homeowner_visible}
                onCheckedChange={(checked) => setFormData(prev => ({ ...prev, is_homeowner_visible: checked }))}
              />
              <Label htmlFor="homeowner-visible">Visible to Homeowners</Label>
            </div>
          </CardContent>
        </Card>

        {/* Template Content */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Template Content</CardTitle>
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => setShowTagPicker(true)}
                disabled
              >
                <Tag className="mr-2 h-4 w-4" />
                Insert Tag (Coming Soon)
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <Textarea
              id="content-textarea"
              value={formData.content}
              onChange={handleContentChange}
              placeholder="Template content management will be implemented with template versions. This is a basic text editor for now."
              rows={20}
              className="font-mono text-sm"
              disabled
            />
            <p className="text-xs text-muted-foreground mt-2">
              Note: Template content storage is being implemented via template versions. For now, only template metadata can be edited.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Tag Picker Modal - Disabled until content storage is implemented */}
      {false && showTagPicker && (
        <TagPicker
          context={formData.default_context}
          onSelectTag={insertTag}
          onClose={() => setShowTagPicker(false)}
        />
      )}
    </div>
  );
};