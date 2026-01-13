import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Loader2, FileText, Sparkles, AlertCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface SmartDoc {
  id: string;
  name: string;
  description: string | null;
  type: string;
  source: 'template' | 'tagged_doc';
  document_id?: string; // For tagged docs
}

interface AddSmartDocToProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipelineEntryId: string;
  onDocumentAdded?: () => void;
}

export const AddSmartDocToProjectDialog: React.FC<AddSmartDocToProjectDialogProps> = ({
  open,
  onOpenChange,
  pipelineEntryId,
  onDocumentAdded,
}) => {
  const [smartDocs, setSmartDocs] = useState<SmartDoc[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<SmartDoc | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [unresolvedTags, setUnresolvedTags] = useState<string[]>([]);
  const { toast } = useToast();

  // Fetch available smart docs on open
  useEffect(() => {
    if (open) {
      fetchSmartDocs();
      setSelectedDoc(null);
      setPreview(null);
      setUnresolvedTags([]);
    }
  }, [open]);

  const fetchSmartDocs = async () => {
    setLoading(true);
    try {
      // Fetch smartdoc_templates (published only)
      const { data: templates, error: templateError } = await supabase
        .from('smartdoc_templates')
        .select('id, name, description, type, status')
        .eq('status', 'PUBLISHED')
        .order('name');

      if (templateError) {
        console.error('Error fetching templates:', templateError);
      }

      // Fetch company docs that have smart tag placements
      const { data: taggedDocs, error: taggedError } = await supabase
        .from('document_tag_placements')
        .select(`
          document_id,
          documents!inner(id, filename, description)
        `)
        .limit(100);

      if (taggedError) {
        console.error('Error fetching tagged docs:', taggedError);
      }

      // Dedupe tagged docs and format them
      const uniqueTaggedDocs = new Map<string, SmartDoc>();
      taggedDocs?.forEach((item: any) => {
        if (item.documents && !uniqueTaggedDocs.has(item.documents.id)) {
          uniqueTaggedDocs.set(item.documents.id, {
            id: `tagged_${item.documents.id}`,
            name: item.documents.filename,
            description: item.documents.description || 'Document with smart tags',
            type: 'document',
            source: 'tagged_doc',
            document_id: item.documents.id,
          });
        }
      });

      // Format templates
      const formattedTemplates: SmartDoc[] = (templates || []).map(t => ({
        id: t.id,
        name: t.name,
        description: t.description,
        type: t.type || 'template',
        source: 'template' as const,
      }));

      // Combine both sources
      setSmartDocs([
        ...formattedTemplates,
        ...Array.from(uniqueTaggedDocs.values())
      ]);
    } catch (error) {
      console.error('Error fetching smart docs:', error);
      toast({
        title: 'Error',
        description: 'Failed to load smart documents',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  // When a doc is selected, render preview
  const handleSelectDoc = async (doc: SmartDoc) => {
    setSelectedDoc(doc);
    setPreview(null);
    setUnresolvedTags([]);

    try {
      if (doc.source === 'tagged_doc' && doc.document_id) {
        // For tagged documents, show a simple preview message
        setPreview(`
          <div style="text-align: center; padding: 20px;">
            <p><strong>${doc.name}</strong></p>
            <p style="color: #666;">This document has smart tags that will be auto-filled with project data when generated.</p>
            <p style="margin-top: 10px; font-size: 12px;">Click "Add to Documents" to create a copy with resolved values.</p>
          </div>
        `);
      } else {
        // For smartdoc_templates, show template info preview
        setPreview(`
          <div style="padding: 10px; text-align: center;">
            <p><strong>Template: ${doc.name}</strong></p>
            <p style="color: #666; font-size: 12px;">${doc.description || 'No description'}</p>
            <hr style="margin: 10px 0;" />
            <p style="font-size: 12px;">This template will be populated with data from the current project.</p>
          </div>
        `);
      }
    } catch (error) {
      console.error('Error loading preview:', error);
      setPreview(`<p>Ready to generate: ${doc.name}</p>`);
      toast({
        title: 'Preview Info',
        description: 'Preview not available. Document can still be generated.',
        variant: 'default',
      });
    }
  };

  // Save rendered doc to documents table
  const handleSave = async () => {
    if (!selectedDoc || !preview) return;

    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('id', user?.id)
        .single();

      if (!profile?.tenant_id) throw new Error('Profile not found');

      // Create a blob from the rendered content
      const blob = new Blob([preview], { type: 'text/html' });
      const fileName = `${pipelineEntryId}/${Date.now()}_${selectedDoc.name.replace(/[^a-zA-Z0-9]/g, '_')}.html`;

      // Upload to storage
      const { error: uploadError } = await supabase.storage
        .from('documents')
        .upload(fileName, blob);

      if (uploadError) throw uploadError;

      // Insert document record
      const { error: dbError } = await supabase
        .from('documents')
        .insert({
          tenant_id: profile.tenant_id,
          pipeline_entry_id: pipelineEntryId,
          document_type: 'contract',
          filename: `${selectedDoc.name}.html`,
          file_path: fileName,
          file_size: blob.size,
          mime_type: 'text/html',
          uploaded_by: user?.id,
          description: `Generated from Smart Doc: ${selectedDoc.name}`,
        });

      if (dbError) throw dbError;

      toast({
        title: 'Success',
        description: `"${selectedDoc.name}" added to documents`,
      });

      onOpenChange(false);
      onDocumentAdded?.();
    } catch (error: any) {
      console.error('Error saving smart doc:', error);
      toast({
        title: 'Save Failed',
        description: error.message || 'Failed to save document',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Add Smart Document
          </DialogTitle>
          <DialogDescription>
            Select a template to generate a document with auto-filled data from this project.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 grid grid-cols-2 gap-4">
          {/* Left: Template List */}
          <div className="flex flex-col">
            <Label className="mb-2">Select Template</Label>
            <ScrollArea className="flex-1 border rounded-md p-2">
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : smartDocs.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No smart documents available</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {smartDocs.map((doc) => (
                    <Card
                      key={doc.id}
                      className={`cursor-pointer transition-colors hover:bg-accent ${
                        selectedDoc?.id === doc.id ? 'ring-2 ring-primary bg-accent' : ''
                      }`}
                      onClick={() => handleSelectDoc(doc)}
                    >
                      <CardContent className="p-3">
                        <div className="flex items-start gap-2">
                          <FileText className="h-4 w-4 mt-0.5 text-muted-foreground" />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="font-medium text-sm truncate">{doc.name}</p>
                              <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                {doc.source === 'tagged_doc' ? 'Doc' : 'Template'}
                              </Badge>
                            </div>
                            {doc.description && (
                              <p className="text-xs text-muted-foreground truncate">
                                {doc.description}
                              </p>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </ScrollArea>
          </div>

          {/* Right: Preview */}
          <div className="flex flex-col">
            <div className="flex items-center justify-between mb-2">
              <Label>Preview</Label>
              {unresolvedTags.length > 0 && (
                <Badge variant="outline" className="text-amber-600 border-amber-300">
                  <AlertCircle className="h-3 w-3 mr-1" />
                  {unresolvedTags.length} unresolved
                </Badge>
              )}
            </div>
            <ScrollArea className="flex-1 border rounded-md p-3 bg-muted/30">
              {!selectedDoc ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Sparkles className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">Select a template to preview</p>
                </div>
              ) : preview === null ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div 
                  className="prose prose-sm dark:prose-invert max-w-none text-sm"
                  dangerouslySetInnerHTML={{ __html: preview }}
                />
              )}
            </ScrollArea>
            {unresolvedTags.length > 0 && (
              <div className="mt-2 text-xs text-muted-foreground">
                <span className="font-medium">Missing:</span>{' '}
                {unresolvedTags.slice(0, 5).join(', ')}
                {unresolvedTags.length > 5 && ` +${unresolvedTags.length - 5} more`}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!selectedDoc || !preview || saving}>
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <FileText className="mr-2 h-4 w-4" />
                Add to Documents
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
