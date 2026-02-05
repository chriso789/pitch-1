import React, { useState, useEffect } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { 
  Plus, 
  Search, 
  FileText, 
  Folder, 
  Upload, 
  Download, 
  Mail, 
  Sparkles, 
  FolderUp,
  Eye,
  Pencil,
  Tag,
  UserPlus,
  Trash2
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { TemplateEditor } from "./TemplateEditor";
import { TemplateLibrary } from "./TemplateLibrary";

import { ProfessionalTemplatesDialog } from "@/components/documents/ProfessionalTemplatesDialog";
import { BulkDocumentUpload } from "./BulkDocumentUpload";
import { DocumentPreviewModal } from "@/components/documents/DocumentPreviewModal";
import { DocumentRenameDialog } from "./DocumentRenameDialog";
import { DocumentTagEditor } from "./DocumentTagEditor";
import { ApplyDocumentToLeadDialog } from "./ApplyDocumentToLeadDialog";
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

interface CompanyDoc {
  id: string;
  filename: string;
  file_path: string;
  file_size: number;
  mime_type: string;
  description: string;
  document_type: string;
  created_at: string;
}

interface TaggedDocument extends CompanyDoc {
  tag_count: number;
}

const SmartDocs = () => {
  const [templates, setTemplates] = useState<SmartDocTemplate[]>([]);
  const [folders, setFolders] = useState<SmartDocFolder[]>([]);
  const [companyDocs, setCompanyDocs] = useState<CompanyDoc[]>([]);
  const [taggedDocs, setTaggedDocs] = useState<TaggedDocument[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<SmartDocTemplate | null>(null);
  const [loading, setLoading] = useState(true);
  const [showProfessionalTemplates, setShowProfessionalTemplates] = useState(false);
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  
  // Admin-only editing state
  const [canEditSmartTags, setCanEditSmartTags] = useState(false);
  
  // New state for document actions
  const [previewDoc, setPreviewDoc] = useState<CompanyDoc | null>(null);
  const [renameDoc, setRenameDoc] = useState<CompanyDoc | null>(null);
  const [tagEditorDoc, setTagEditorDoc] = useState<CompanyDoc | null>(null);
  const [applyToLeadDoc, setApplyToLeadDoc] = useState<CompanyDoc | null>(null);
  const [deleteDoc, setDeleteDoc] = useState<CompanyDoc | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Check if user has admin role (master or owner)
  useEffect(() => {
    const checkAdminRole = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      
      // Check user_roles table for master or owner role
      const { data: roles } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id);
      
      const isAdmin = roles?.some(r => r.role === 'master' || r.role === 'owner') ?? false;
      setCanEditSmartTags(isAdmin);
    };
    
    checkAdminRole();
  }, []);

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      
      // Load templates, folders, and company docs in parallel
      // Get user's tenant first for logging
      const { data: { user } } = await supabase.auth.getUser();
      console.log('[SmartDocs] Loading data for user:', user?.id);

      const [templatesResult, foldersResult, docsResult, taggedDocsResult] = await Promise.all([
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
          .order('created_at', { ascending: false }),
        
        // Get documents that have smart tag placements
        supabase
          .from('document_tag_placements')
          .select('document_id')
      ]);

      if (templatesResult.error) throw templatesResult.error;
      if (foldersResult.error) throw foldersResult.error;
      if (docsResult.error) {
        console.error('[SmartDocs] Error loading company docs:', docsResult.error);
      }

      console.log('[SmartDocs] Loaded company docs:', docsResult.data?.length || 0, 'documents');
      if (docsResult.data && docsResult.data.length > 0) {
        console.log('[SmartDocs] First doc sample:', {
          id: docsResult.data[0].id,
          filename: docsResult.data[0].filename,
          document_type: docsResult.data[0].document_type
        });
      }

      // Count tags per document
      const tagCountMap = new Map<string, number>();
      if (taggedDocsResult.data) {
        taggedDocsResult.data.forEach((placement: { document_id: string }) => {
          const count = tagCountMap.get(placement.document_id) || 0;
          tagCountMap.set(placement.document_id, count + 1);
        });
      }

      // Filter documents that have tags and add count
      const docsWithTags: TaggedDocument[] = (docsResult.data || [])
        .filter(doc => tagCountMap.has(doc.id))
        .map(doc => ({
          ...doc,
          tag_count: tagCountMap.get(doc.id) || 0
        }));

      console.log('[SmartDocs] Documents with smart tags:', docsWithTags.length);

      setTemplates(templatesResult.data || []);
      setFolders(foldersResult.data || []);
      setCompanyDocs(docsResult.data || []);
      setTaggedDocs(docsWithTags);
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

    // Validate file type - only PDFs allowed for company docs
    const allowedTypes = ['application/pdf'];
    if (!allowedTypes.includes(file.type)) {
      toast.error("Only PDF files are accepted for Company Documents");
      // Reset the input so the same file can be re-selected
      event.target.value = '';
      return;
    }

    try {
      // Get user's tenant_id
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error("You must be logged in to upload documents");
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("tenant_id")
        .eq("id", user.id)
        .single();

      if (profileError || !profile?.tenant_id) {
        toast.error("Failed to get tenant information");
        return;
      }

      // Upload to Supabase storage
      const fileName = `company-docs/${Date.now()}-${file.name}`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('smartdoc-assets')
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      // Create document record with dynamic tenant_id
      const { error: insertError } = await supabase
        .from('documents')
        .insert({
          filename: file.name,
          file_path: uploadData.path,
          file_size: file.size,
          mime_type: file.type,
          document_type: 'company_resource',
          description: `Company resource document`,
          tenant_id: profile.tenant_id
        });

      if (insertError) throw insertError;

      toast.success('Document uploaded successfully');
      loadData(); // Reload to show new document
    } catch (error) {
      console.error('Error uploading file:', error);
      toast.error('Failed to upload document');
    }
  };

  const handleDownload = async (doc: CompanyDoc) => {
    try {
      // Use public URL to bypass RLS issues
      const { data: urlData } = supabase.storage
        .from('smartdoc-assets')
        .getPublicUrl(doc.file_path);

      const response = await fetch(urlData.publicUrl);
      if (!response.ok) throw new Error('Failed to fetch file');
      
      const data = await response.blob();
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

  const handleDeleteDoc = async () => {
    if (!deleteDoc) return;
    
    setDeleting(true);
    try {
      const { data, error } = await supabase.functions.invoke('delete-documents', {
        body: { document_ids: [deleteDoc.id], mode: 'delete_only' }
      });

      if (error) throw error;

      if (data?.success) {
        toast.success('Document deleted successfully');
        loadData();
      } else if (data?.blocked_ids?.length > 0) {
        toast.error('Cannot delete - document is referenced elsewhere');
      } else {
        throw new Error(data?.errors?.[0] || 'Failed to delete document');
      }
    } catch (error) {
      console.error('Error deleting document:', error);
      toast.error('Failed to delete document');
    } finally {
      setDeleting(false);
      setDeleteDoc(null);
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

  // Show tag editor fullscreen
  if (tagEditorDoc) {
    return (
      <DocumentTagEditor
        document={tagEditorDoc}
        onClose={() => setTagEditorDoc(null)}
        onSave={() => {
          setTagEditorDoc(null);
          loadData();
        }}
      />
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

      <Tabs defaultValue="smart-docs" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="smart-docs">Smart Docs</TabsTrigger>
          <TabsTrigger value="library">Template Library</TabsTrigger>
          <TabsTrigger value="company-docs">Company Docs</TabsTrigger>
          <TabsTrigger value="folders">Folders</TabsTrigger>
        </TabsList>

        <TabsContent value="smart-docs" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5" />
                Tagged Documents
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Company documents with smart tag placements. These can be applied to leads/projects with auto-filled data.
              </p>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4">
                {taggedDocs.map((doc) => (
                  <div key={doc.id} className="flex items-center justify-between p-4 border rounded-lg hover:bg-muted/50 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-primary/10 rounded-lg">
                        <FileText className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <h4 className="font-medium">{doc.filename}</h4>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="secondary" className="gap-1">
                            <Tag className="h-3 w-3" />
                            {doc.tag_count} smart tag{doc.tag_count !== 1 ? 's' : ''}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            Uploaded {new Date(doc.created_at).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setPreviewDoc(doc)}
                        className="gap-1"
                      >
                        <Eye className="h-4 w-4" />
                        Preview
                      </Button>
                      {canEditSmartTags && (
                        <>
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => setTagEditorDoc(doc)}
                            className="gap-1"
                          >
                            <Sparkles className="h-4 w-4" />
                            Edit Tags
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => setDeleteDoc(doc)}
                            className="gap-1"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                      <Button
                        size="sm"
                        variant="default"
                        onClick={() => setApplyToLeadDoc(doc)}
                        className="gap-1"
                      >
                        <UserPlus className="h-4 w-4" />
                        Apply to Lead
                      </Button>
                    </div>
                  </div>
                ))}
                {taggedDocs.length === 0 && (
                  <div className="text-center py-8">
                    <Sparkles className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                    <h3 className="text-lg font-medium mb-2">No tagged documents yet</h3>
                    <p className="text-muted-foreground mb-4">
                      Go to Company Docs tab and click "Configure Smart Tags" on a document to add smart tags
                    </p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

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
                accept=".pdf,application/pdf"
              />
              <Button
                variant="outline"
                onClick={() => setShowBulkUpload(true)}
                className="gap-2"
              >
                <FolderUp className="h-4 w-4" />
                Bulk Upload
              </Button>
              <Button
                onClick={() => document.getElementById('file-upload')?.click()}
                className="gap-2"
              >
                <Upload className="h-4 w-4" />
                Upload Document
              </Button>
            </div>
          
            <BulkDocumentUpload
              open={showBulkUpload}
              onOpenChange={setShowBulkUpload}
              onUploadComplete={loadData}
            />
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
                  <div className="flex gap-2 flex-wrap justify-end">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setPreviewDoc(doc)}
                      className="gap-1"
                    >
                      <Eye className="h-4 w-4" />
                      Preview
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleDownload(doc)}
                      className="gap-1"
                    >
                      <Download className="h-4 w-4" />
                      Download
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setRenameDoc(doc)}
                      className="gap-1"
                    >
                      <Pencil className="h-4 w-4" />
                      Rename
                    </Button>
                    {canEditSmartTags && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setTagEditorDoc(doc)}
                        className="gap-1 bg-primary/10 hover:bg-primary/20 text-primary"
                      >
                        <Sparkles className="h-4 w-4" />
                        Configure Smart Tags
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => setDeleteDoc(doc)}
                      className="gap-1"
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete
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

      {/* Preview Modal - show only the selected document */}
      <DocumentPreviewModal
        isOpen={!!previewDoc}
        onClose={() => setPreviewDoc(null)}
        document={previewDoc ? {
          id: previewDoc.id,
          filename: previewDoc.filename,
          file_path: previewDoc.file_path,
          mime_type: previewDoc.mime_type,
          document_type: previewDoc.document_type
        } : null}
        documents={previewDoc ? [{
          id: previewDoc.id,
          filename: previewDoc.filename,
          file_path: previewDoc.file_path,
          mime_type: previewDoc.mime_type,
          document_type: previewDoc.document_type
        }] : []}
        onDownload={() => previewDoc && handleDownload(previewDoc)}
      />

      {/* Rename Dialog */}
      <DocumentRenameDialog
        open={!!renameDoc}
        onOpenChange={(open) => !open && setRenameDoc(null)}
        document={renameDoc}
        onRenameComplete={() => {
          setRenameDoc(null);
          loadData();
        }}
      />

      {/* Apply to Lead Dialog */}
      <ApplyDocumentToLeadDialog
        open={!!applyToLeadDoc}
        onOpenChange={(open) => !open && setApplyToLeadDoc(null)}
        document={applyToLeadDoc}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!deleteDoc} onOpenChange={(open) => !open && setDeleteDoc(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Document</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deleteDoc?.filename}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleDeleteDoc} 
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default SmartDocs;
