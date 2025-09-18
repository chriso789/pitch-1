import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, FileText, Folder } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/components/ui/use-toast";
import { TemplateEditor } from "./TemplateEditor";
import { TemplateLibrary } from "./TemplateLibrary";

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

interface SmartDocFolder {
  id: string;
  name: string;
  created_at: string;
}

const SmartDocs = () => {
  const [templates, setTemplates] = useState<SmartDocTemplate[]>([]);
  const [folders, setFolders] = useState<SmartDocFolder[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<SmartDocTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      
      // Load templates and folders in parallel
      const [templatesResult, foldersResult] = await Promise.all([
        supabase
          .from('smartdoc_templates')
          .select(`
            id,
            name,
            type,
            description,
            status,
            is_homeowner_visible,
            created_at,
            smartdoc_folders!folder_id(name)
          `)
          .order('created_at', { ascending: false }),
        
        supabase
          .from('smartdoc_folders')
          .select('*')
          .order('name', { ascending: true })
      ]);

      if (templatesResult.error) throw templatesResult.error;
      if (foldersResult.error) throw foldersResult.error;

      setTemplates(templatesResult.data || []);
      setFolders(foldersResult.data || []);
    } catch (error) {
      console.error('Error loading Smart Docs data:', error);
      toast({
        title: "Error",
        description: "Failed to load templates and folders",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleNewTemplate = () => {
    setEditingTemplate(null);
    setShowEditor(true);
  };

  const handleEditTemplate = (template: SmartDocTemplate) => {
    setEditingTemplate(template);
    setShowEditor(true);
  };

  const handleCloseEditor = () => {
    setShowEditor(false);
    setEditingTemplate(null);
    loadData(); // Refresh data
  };

  const filteredTemplates = templates.filter(template => {
    const matchesSearch = template.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         template.description?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFolder = !selectedFolder || template.smartdoc_folders?.name === selectedFolder;
    return matchesSearch && matchesFolder;
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active': return 'bg-green-500';
      case 'draft': return 'bg-yellow-500';
      case 'archived': return 'bg-gray-500';
      default: return 'bg-blue-500';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (showEditor) {
    return (
      <TemplateEditor
        template={editingTemplate}
        folders={folders}
        onClose={handleCloseEditor}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Smart Docs</h1>
          <p className="text-muted-foreground">
            Create and manage intelligent document templates with dynamic tags
          </p>
        </div>
        <Button onClick={handleNewTemplate}>
          <Plus className="mr-2 h-4 w-4" />
          New Template
        </Button>
      </div>

      <Tabs defaultValue="library" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="library">Template Library</TabsTrigger>
          <TabsTrigger value="folders">Folders</TabsTrigger>
        </TabsList>

        <TabsContent value="library" className="space-y-4">
          <div className="flex items-center space-x-4">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search templates..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-8"
              />
            </div>
            <select
              value={selectedFolder || ""}
              onChange={(e) => setSelectedFolder(e.target.value || null)}
              className="px-3 py-2 border rounded-md bg-background"
            >
              <option value="">All Folders</option>
              {folders.map(folder => (
                <option key={folder.id} value={folder.name}>
                  {folder.name}
                </option>
              ))}
            </select>
          </div>

          <TemplateLibrary
            templates={filteredTemplates}
            onEditTemplate={handleEditTemplate}
            onRefresh={loadData}
          />
        </TabsContent>

        <TabsContent value="folders" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {folders.map(folder => (
              <Card key={folder.id} className="cursor-pointer hover:shadow-md transition-shadow">
                <CardHeader>
                  <CardTitle className="flex items-center space-x-2">
                    <Folder className="h-5 w-5" />
                    <span>{folder.name}</span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    {templates.filter(t => t.smartdoc_folders?.name === folder.name).length} templates
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Created {new Date(folder.created_at).toLocaleDateString()}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default SmartDocs;