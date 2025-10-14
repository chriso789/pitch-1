import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, FileText, Folder, Upload, Download, Mail, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { TemplateEditor } from "./TemplateEditor";
import { TemplateLibrary } from "./TemplateLibrary";
import { ProfessionalTemplatesDialog } from "@/components/documents/ProfessionalTemplatesDialog";

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
  const [companyDocs, setCompanyDocs] = useState<any[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<SmartDocTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [showProfessionalTemplates, setShowProfessionalTemplates] = useState(false);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      
      // Load templates, folders, and company docs in parallel
      const [templatesResult, foldersResult, docsResult] = await Promise.all([
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
          .order('name', { ascending: true }),
          
        supabase
          .from('documents')
          .select('*')
          .eq('document_type', 'company_resource')
          .order('created_at', { ascending: false })
      ]);

      if (templatesResult.error) throw templatesResult.error;
      if (foldersResult.error) throw foldersResult.error;
      if (docsResult.error) console.error('Error loading docs:', docsResult.error);

      setTemplates(templatesResult.data || []);
      setFolders(foldersResult.data || []);
      setCompanyDocs(docsResult.data || []);
    } catch (error) {
      console.error('Error loading Smart Docs data:', error);
      toast.error("Failed to load templates and folders");
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

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      // Upload to Supabase storage
      const fileName = `company-docs/${Date.now()}-${file.name}`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('smartdoc-assets')
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      // Create document record
      const { error: insertError } = await supabase
        .from('documents')
        .insert({
          filename: file.name,
          file_path: uploadData.path,
          file_size: file.size,
          mime_type: file.type,
          document_type: 'company_resource',
          description: `Company resource document`,
          tenant_id: "14de934e-7964-4afd-940a-620d2ace125d"
        });

      if (insertError) throw insertError;

      toast.success('Document uploaded successfully');
      loadData(); // Reload to show new document
    } catch (error) {
      console.error('Error uploading file:', error);
      toast.error('Failed to upload document');
    }
  };

  const handleDownload = async (doc: any) => {
    try {
      const { data, error } = await supabase.storage
        .from('smartdoc-assets')
        .download(doc.file_path);

      if (error) throw error;

      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error downloading file:', error);
      toast.error('Failed to download document');
    }
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
        <div className="flex gap-2">
          <Button onClick={() => setShowProfessionalTemplates(true)} variant="outline">
            <Sparkles className="mr-2 h-4 w-4" />
            Professional Templates
          </Button>
          <Button onClick={handleNewTemplate}>
            <Plus className="mr-2 h-4 w-4" />
            New Template
          </Button>
        </div>
      </div>

      <ProfessionalTemplatesDialog
        open={showProfessionalTemplates}
        onClose={() => setShowProfessionalTemplates(false)}
      />

      <Tabs defaultValue="library" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="library">Template Library</TabsTrigger>
          <TabsTrigger value="company-docs">Company Docs</TabsTrigger>
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

        <TabsContent value="company-docs" className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-medium">Company Documents</h3>
              <p className="text-sm text-muted-foreground">
                Upload company resources for your team to access
              </p>
            </div>
            <div className="flex gap-2">
              <input
                type="file"
                id="file-upload"
                className="hidden"
                onChange={handleFileUpload}
                accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.jpg,.jpeg,.png"
              />
              <Button
                onClick={() => document.getElementById('file-upload')?.click()}
                className="gap-2"
              >
                <Upload className="h-4 w-4" />
                Upload Document
              </Button>
            </div>
          </div>

          <div className="grid gap-4">
            {companyDocs.map((doc) => (
              <Card key={doc.id} className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-primary/10 rounded-lg">
                      <FileText className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <h4 className="font-medium">{doc.filename}</h4>
                      <p className="text-sm text-muted-foreground">
                        {doc.description} • {Math.round(doc.file_size / 1024)}KB
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Uploaded {new Date(doc.created_at).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleDownload(doc)}
                      className="gap-2"
                    >
                      <Download className="h-4 w-4" />
                      Download
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => toast.info('Email functionality coming soon')}
                      className="gap-2"
                    >
                      <Mail className="h-4 w-4" />
                      Email
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
            {companyDocs.length === 0 && (
              <Card className="p-8 text-center">
                <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-medium mb-2">No company documents</h3>
                <p className="text-muted-foreground mb-4">
                  Upload documents that your team can access and share with customers
                </p>
                <Button
                  onClick={() => document.getElementById('file-upload')?.click()}
                  className="gap-2"
                >
                  <Upload className="h-4 w-4" />
                  Upload First Document
                </Button>
              </Card>
            )}
          </div>
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