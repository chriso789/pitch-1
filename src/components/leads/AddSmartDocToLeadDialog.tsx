import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Loader2, FileText, Search, Sparkles, Check, AlertCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface SmartTag {
  id: string;
  tag_key: string;
  x_position: number;
  y_position: number;
  page_number: number;
}

interface CompanyDoc {
  id: string;
  filename: string;
  file_path: string;
  description?: string;
}

interface ContactData {
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  zip_code?: string;
  [key: string]: any;
}

interface AddSmartDocToLeadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contactId: string;
  contactData: ContactData;
  onDocumentAdded?: () => void;
}

// Smart tag mapping to contact fields
const TAG_TO_FIELD_MAP: Record<string, string> = {
  '{{first_name}}': 'first_name',
  '{{last_name}}': 'last_name',
  '{{full_name}}': 'full_name',
  '{{email}}': 'email',
  '{{phone}}': 'phone',
  '{{address}}': 'address',
  '{{city}}': 'city',
  '{{state}}': 'state',
  '{{zip_code}}': 'zip_code',
  '{{date}}': 'current_date',
  '{{company_name}}': 'company_name',
};

export function AddSmartDocToLeadDialog({
  open,
  onOpenChange,
  contactId,
  contactData,
  onDocumentAdded
}: AddSmartDocToLeadDialogProps) {
  const [documents, setDocuments] = useState<CompanyDoc[]>([]);
  const [selectedDoc, setSelectedDoc] = useState<CompanyDoc | null>(null);
  const [docTags, setDocTags] = useState<SmartTag[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    if (open) {
      loadDocuments();
    }
  }, [open]);

  useEffect(() => {
    if (selectedDoc) {
      loadDocumentTags(selectedDoc.id);
    } else {
      setDocTags([]);
    }
  }, [selectedDoc]);

  const loadDocuments = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('documents')
        .select('id, filename, file_path, description')
        .eq('document_type', 'company_resource')
        .order('filename');

      if (error) throw error;
      setDocuments(data || []);
    } catch (error) {
      console.error('Error loading documents:', error);
      toast.error('Failed to load documents');
    } finally {
      setLoading(false);
    }
  };

  const loadDocumentTags = async (documentId: string) => {
    try {
      const { data, error } = await supabase
        .from('document_tag_placements')
        .select('id, tag_key, x_position, y_position, page_number')
        .eq('document_id', documentId);

      if (error) throw error;
      setDocTags(data || []);
    } catch (error) {
      console.error('Error loading document tags:', error);
      setDocTags([]);
    }
  };

  const getTagValue = (tagName: string): string => {
    const fieldName = TAG_TO_FIELD_MAP[tagName];
    if (!fieldName) return '';

    if (fieldName === 'full_name') {
      return `${contactData.first_name || ''} ${contactData.last_name || ''}`.trim();
    }
    if (fieldName === 'current_date') {
      return new Date().toLocaleDateString();
    }
    if (fieldName === 'company_name') {
      return ''; // Will be filled from tenant
    }
    
    return contactData[fieldName] || '';
  };

  const handleAddDocument = async () => {
    if (!selectedDoc || !contactId) return;

    setSaving(true);
    try {
      // Get user and tenant info
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id, active_tenant_id')
        .eq('id', user.id)
        .single();

      const tenantId = profile?.active_tenant_id || profile?.tenant_id;
      if (!tenantId) throw new Error('No tenant found');

      // Build merged tags data
      const mergedTags: Record<string, string> = {};
      docTags.forEach(tag => {
        mergedTags[tag.tag_key] = getTagValue(tag.tag_key);
      });

      // If the document has tags, call the merge edge function
      if (docTags.length > 0) {
        const { data: mergeResult, error: mergeError } = await supabase.functions.invoke('merge-document-tags', {
          body: {
            documentId: selectedDoc.id,
            contactId,
            tagValues: mergedTags
          }
        });

        if (mergeError) {
          console.error('Merge error:', mergeError);
          // Fall back to just linking the original document
        }

        // Save to contact_documents with merged file path if available
        const { error: insertError } = await supabase
          .from('contact_documents')
          .insert({
            tenant_id: tenantId,
            contact_id: contactId,
            original_document_id: selectedDoc.id,
            filename: selectedDoc.filename,
            file_path: mergeResult?.mergedFilePath || selectedDoc.file_path,
            merged_tags: mergedTags,
            created_by: user.id
          });

        if (insertError) throw insertError;
      } else {
        // No tags, just link the document
        const { error: insertError } = await supabase
          .from('contact_documents')
          .insert({
            tenant_id: tenantId,
            contact_id: contactId,
            original_document_id: selectedDoc.id,
            filename: selectedDoc.filename,
            file_path: selectedDoc.file_path,
            merged_tags: {},
            created_by: user.id
          });

        if (insertError) throw insertError;
      }

      toast.success('Document added to lead successfully');
      onDocumentAdded?.();
      onOpenChange(false);
      setSelectedDoc(null);
    } catch (error: any) {
      console.error('Error adding document to lead:', error);
      toast.error(error.message || 'Failed to add document');
    } finally {
      setSaving(false);
    }
  };

  const filteredDocs = documents.filter(doc =>
    doc.filename.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Add Smart Document to Lead
          </DialogTitle>
          <DialogDescription>
            Select a company document to add. Smart tags will be automatically filled with lead data.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search documents..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9"
            />
          </div>

          {/* Document List */}
          <ScrollArea className="h-[200px] border rounded-lg p-2">
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : filteredDocs.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                <FileText className="h-8 w-8 mb-2" />
                <p className="text-sm">No documents found</p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredDocs.map((doc) => (
                  <Card
                    key={doc.id}
                    className={`p-3 cursor-pointer transition-colors ${
                      selectedDoc?.id === doc.id
                        ? 'border-primary bg-primary/5'
                        : 'hover:bg-muted/50'
                    }`}
                    onClick={() => setSelectedDoc(doc)}
                  >
                    <div className="flex items-center gap-3">
                      <FileText className="h-5 w-5 text-muted-foreground" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{doc.filename}</p>
                        {doc.description && (
                          <p className="text-xs text-muted-foreground truncate">
                            {doc.description}
                          </p>
                        )}
                      </div>
                      {selectedDoc?.id === doc.id && (
                        <Check className="h-5 w-5 text-primary" />
                      )}
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </ScrollArea>

          {/* Tag Preview */}
          {selectedDoc && (
            <div className="border rounded-lg p-4 bg-muted/30">
              <Label className="text-sm font-medium mb-2 block">
                Smart Tags Preview ({docTags.length} tags configured)
              </Label>
              {docTags.length === 0 ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <AlertCircle className="h-4 w-4" />
                  <span>No smart tags configured for this document</span>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {docTags.map((tag) => {
                    const value = getTagValue(tag.tag_key);
                    return (
                      <Badge
                        key={tag.id}
                        variant={value ? 'default' : 'outline'}
                        className="text-xs"
                      >
                        {tag.tag_key}: {value || '(empty)'}
                      </Badge>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleAddDocument}
            disabled={!selectedDoc || saving}
          >
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Adding...
              </>
            ) : (
              <>
                <Sparkles className="mr-2 h-4 w-4" />
                Add to Lead
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
