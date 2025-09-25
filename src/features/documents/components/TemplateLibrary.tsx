import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileText, Edit, Trash2, Eye, Download } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";

interface SmartDocTemplate {
  id: string;
  name: string;
  type: string;
  description?: string;
  status: string;
  is_homeowner_visible: boolean;
  created_at: string;
  smartdoc_folders?: {
    name: string;
  };
}

interface TemplateLibraryProps {
  templates: SmartDocTemplate[];
  onEditTemplate: (template: SmartDocTemplate) => void;
  onRefresh: () => void;
}

export const TemplateLibrary: React.FC<TemplateLibraryProps> = ({
  templates,
  onEditTemplate,
  onRefresh
}) => {
  const { toast } = useToast();

  const handleDelete = async (templateId: string) => {
    if (!confirm("Are you sure you want to delete this template?")) {
      return;
    }

    try {
      const { error } = await supabase
        .from('smartdoc_templates')
        .delete()
        .eq('id', templateId);

      if (error) throw error;

      toast({
        title: "Success",
        description: "Template deleted successfully",
      });
      onRefresh();
    } catch (error) {
      console.error('Error deleting template:', error);
      toast({
        title: "Error",
        description: "Failed to delete template",
        variant: "destructive",
      });
    }
  };

  const handleDuplicate = async (template: SmartDocTemplate) => {
    try {
      // First get the full template with content
      const { data: fullTemplate, error: fetchError } = await supabase
        .from('smartdoc_templates')
        .select('*')
        .eq('id', template.id)
        .single();

      if (fetchError) throw fetchError;

      // Create a duplicate
      const { error: insertError } = await supabase
        .from('smartdoc_templates')
        .insert({
          name: `${fullTemplate.name} (Copy)`,
          type: fullTemplate.type,
          description: fullTemplate.description,
          default_context: fullTemplate.default_context,
          folder_id: fullTemplate.folder_id,
          status: 'DRAFT',
          tenant_id: "14de934e-7964-4afd-940a-620d2ace125d"
        });

      if (insertError) throw insertError;

      toast({
        title: "Success",
        description: "Template duplicated successfully",
      });
      onRefresh();
    } catch (error) {
      console.error('Error duplicating template:', error);
      toast({
        title: "Error",
        description: "Failed to duplicate template",
        variant: "destructive",
      });
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-green-500';
      case 'draft': return 'bg-yellow-500';
      case 'archived': return 'bg-gray-500';
      default: return 'bg-blue-500';
    }
  };

  const getTypeIcon = (type: string) => {
    return <FileText className="h-4 w-4" />;
  };

  if (templates.length === 0) {
    return (
      <Card className="p-8 text-center">
        <FileText className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
        <h3 className="text-lg font-semibold mb-2">No Templates Found</h3>
        <p className="text-muted-foreground mb-4">
          Create your first template to get started with Smart Docs
        </p>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
      {templates.map(template => (
        <Card key={template.id} className="hover:shadow-md transition-shadow">
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between">
              <div className="flex items-center space-x-2">
                {getTypeIcon(template.type)}
                <CardTitle className="text-lg">{template.name}</CardTitle>
              </div>
              <div className="flex items-center space-x-1">
                <Badge 
                  className={`${getStatusColor(template.status)} text-white text-xs`}
                >
                  {template.status}
                </Badge>
                {template.is_homeowner_visible && (
                  <Badge variant="outline" className="text-xs">
                    Public
                  </Badge>
                )}
              </div>
            </div>
          </CardHeader>
          
          <CardContent className="space-y-3">
            {template.description && (
              <p className="text-sm text-muted-foreground line-clamp-2">
                {template.description}
              </p>
            )}
            
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>{template.type}</span>
              {template.smartdoc_folders?.name && (
                <span className="flex items-center">
                  <FileText className="h-3 w-3 mr-1" />
                  {template.smartdoc_folders.name}
                </span>
              )}
            </div>
            
            <div className="text-xs text-muted-foreground">
              Created {new Date(template.created_at).toLocaleDateString()}
            </div>

            <div className="flex items-center space-x-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => onEditTemplate(template)}
                className="flex-1"
              >
                <Edit className="h-3 w-3 mr-1" />
                Edit
              </Button>
              
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleDuplicate(template)}
              >
                <FileText className="h-3 w-3" />
              </Button>
              
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleDelete(template.id)}
                className="text-destructive hover:text-destructive"
              >
                <Trash2 className="h-3 w-3" />
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
};