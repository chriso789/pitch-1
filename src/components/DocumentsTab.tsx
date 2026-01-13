import React, { useState, useEffect, useMemo, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { 
  FileText, Download, Trash2, Upload, Eye,
  File, Image as ImageIcon, FileCheck, FileLock, X,
  Package, Wrench, DollarSign, Loader2, Sparkles
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { formatDistanceToNow, isAfter, isBefore, startOfDay, endOfDay } from 'date-fns';
import { DocumentPreviewModal } from '@/components/documents/DocumentPreviewModal';
import { DocumentSearchFilters } from '@/components/documents/DocumentSearchFilters';
import { AddSmartDocToProjectDialog } from '@/components/documents/AddSmartDocToProjectDialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

interface Document {
  id: string;
  filename: string;
  file_path: string;
  file_size: number;
  mime_type: string | null;
  document_type: string | null;
  description: string | null;
  created_at: string;
  uploaded_by: string | null;
  uploader?: {
    first_name: string;
    last_name: string;
  };
}

interface DocumentsTabProps {
  pipelineEntryId: string;
  onUploadComplete?: () => void;
}

const DOCUMENT_CATEGORIES = [
  { value: 'contract', label: 'Contracts', icon: FileCheck, color: 'bg-blue-500', tracksCost: false },
  { value: 'estimate', label: 'Estimates', icon: FileText, color: 'bg-green-500', tracksCost: false },
  { value: 'insurance', label: 'Insurance', icon: FileLock, color: 'bg-purple-500', tracksCost: false },
  { value: 'photo', label: 'Photos', icon: ImageIcon, color: 'bg-orange-500', tracksCost: false },
  { value: 'permit', label: 'Permits', icon: FileCheck, color: 'bg-red-500', tracksCost: false },
  { value: 'invoice_material', label: 'Material Invoice', icon: Package, color: 'bg-amber-500', tracksCost: true },
  { value: 'invoice_labor', label: 'Labor Invoice', icon: Wrench, color: 'bg-cyan-500', tracksCost: true },
  { value: 'other', label: 'Other', icon: File, color: 'bg-gray-500', tracksCost: false },
];

const RECENT_DOCS_LIMIT = 10;

export const DocumentsTab: React.FC<DocumentsTabProps> = ({ 
  pipelineEntryId,
  onUploadComplete 
}) => {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [showAllDocs, setShowAllDocs] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<Document | null>(null);
  
  // Bulk selection state
  const [selectedDocs, setSelectedDocs] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  
  // Invoice dialog state
  const [invoiceDialogOpen, setInvoiceDialogOpen] = useState(false);
  const [pendingInvoiceFile, setPendingInvoiceFile] = useState<File | null>(null);
  const [pendingInvoiceType, setPendingInvoiceType] = useState<'material' | 'labor'>('material');
  const [invoiceAmount, setInvoiceAmount] = useState('');
  const [vendorName, setVendorName] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [isLinkingInvoice, setIsLinkingInvoice] = useState(false);
  
  // Smart doc dialog state
  const [addSmartDocOpen, setAddSmartDocOpen] = useState(false);
  
  // Search and filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [dateFrom, setDateFrom] = useState<Date | undefined>();
  const [dateTo, setDateTo] = useState<Date | undefined>();
  const [uploaderFilter, setUploaderFilter] = useState('all');
  
  const { toast } = useToast();

  useEffect(() => {
    fetchDocuments();
  }, [pipelineEntryId]);

  const fetchDocuments = async () => {
    try {
      const { data, error } = await supabase
        .from('documents')
        .select(`
          *,
          uploader:uploaded_by (
            first_name,
            last_name
          )
        `)
        .eq('pipeline_entry_id', pipelineEntryId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setDocuments(data || []);
    } catch (error) {
      console.error('Error fetching documents:', error);
      toast({
        title: 'Error',
        description: 'Failed to load documents',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  // Get unique uploaders for filter dropdown
  const uploaders = useMemo(() => {
    const uniqueUploaders = new Map<string, { id: string; name: string }>();
    documents.forEach(doc => {
      if (doc.uploaded_by && doc.uploader) {
        uniqueUploaders.set(doc.uploaded_by, {
          id: doc.uploaded_by,
          name: `${doc.uploader.first_name} ${doc.uploader.last_name}`.trim(),
        });
      }
    });
    return Array.from(uniqueUploaders.values());
  }, [documents]);

  // Count documents by category
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    DOCUMENT_CATEGORIES.forEach(cat => {
      counts[cat.value] = documents.filter(d => d.document_type === cat.value).length;
    });
    return counts;
  }, [documents]);

  // Apply filters
  const filteredDocuments = useMemo(() => {
    return documents.filter(doc => {
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        if (!doc.filename.toLowerCase().includes(query)) {
          return false;
        }
      }

      // Category filter
      if (categoryFilter !== 'all' && doc.document_type !== categoryFilter) {
        return false;
      }

      // Date range filter
      if (dateFrom) {
        const docDate = new Date(doc.created_at);
        if (isBefore(docDate, startOfDay(dateFrom))) {
          return false;
        }
      }
      if (dateTo) {
        const docDate = new Date(doc.created_at);
        if (isAfter(docDate, endOfDay(dateTo))) {
          return false;
        }
      }

      // Uploader filter
      if (uploaderFilter !== 'all' && doc.uploaded_by !== uploaderFilter) {
        return false;
      }

      return true;
    });
  }, [documents, searchQuery, categoryFilter, dateFrom, dateTo, uploaderFilter]);

  // Documents to display (limited or all)
  const displayedDocuments = showAllDocs 
    ? filteredDocuments 
    : filteredDocuments.slice(0, RECENT_DOCS_LIMIT);

  const handleFileUpload = async (file: File, category: string) => {
    setUploading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('id', user?.id)
        .single();

      const fileExt = file.name.split('.').pop();
      const fileName = `${pipelineEntryId}/${Date.now()}.${fileExt}`;
      
      const { error: uploadError } = await supabase.storage
        .from('documents')
        .upload(fileName, file);

      if (uploadError) throw uploadError;

      const { error: dbError } = await supabase
        .from('documents')
        .insert({
          tenant_id: profile?.tenant_id,
          pipeline_entry_id: pipelineEntryId,
          document_type: category,
          filename: file.name,
          file_path: fileName,
          file_size: file.size,
          mime_type: file.type,
          uploaded_by: user?.id,
        });

      if (dbError) throw dbError;

      toast({
        title: 'Success',
        description: 'Document uploaded successfully',
      });

      fetchDocuments();
      onUploadComplete?.();
    } catch (error: any) {
      console.error('Upload error:', error);
      toast({
        title: 'Upload Failed',
        description: error.message || 'Failed to upload document',
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
    }
  };

  // Handle invoice file selection - opens dialog to enter amount
  const handleInvoiceFileSelect = (file: File, invoiceType: 'material' | 'labor') => {
    setPendingInvoiceFile(file);
    setPendingInvoiceType(invoiceType);
    setInvoiceAmount('');
    setVendorName('');
    setInvoiceNumber('');
    setInvoiceDialogOpen(true);
  };

  // Complete invoice upload with amount
  const handleInvoiceUploadComplete = async () => {
    if (!pendingInvoiceFile || !invoiceAmount) {
      toast({
        title: 'Missing Information',
        description: 'Please enter the invoice amount',
        variant: 'destructive',
      });
      return;
    }

    const amount = parseFloat(invoiceAmount.replace(/[^0-9.]/g, ''));
    if (isNaN(amount) || amount <= 0) {
      toast({
        title: 'Invalid Amount',
        description: 'Please enter a valid invoice amount',
        variant: 'destructive',
      });
      return;
    }

    setIsLinkingInvoice(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('id', user?.id)
        .single();

      if (!profile?.tenant_id) throw new Error('Profile not found');

      // 1. Upload the file to storage
      const fileExt = pendingInvoiceFile.name.split('.').pop();
      const fileName = `${pipelineEntryId}/${Date.now()}.${fileExt}`;
      
      const { error: uploadError } = await supabase.storage
        .from('documents')
        .upload(fileName, pendingInvoiceFile);

      if (uploadError) throw uploadError;

      // 2. Insert document record
      const docType = pendingInvoiceType === 'material' ? 'invoice_material' : 'invoice_labor';
      const { data: docData, error: dbError } = await supabase
        .from('documents')
        .insert({
          tenant_id: profile.tenant_id,
          pipeline_entry_id: pipelineEntryId,
          document_type: docType,
          filename: pendingInvoiceFile.name,
          file_path: fileName,
          file_size: pendingInvoiceFile.size,
          mime_type: pendingInvoiceFile.type,
          uploaded_by: user?.id,
          invoice_amount: amount,
          vendor_name: vendorName || null,
          invoice_number: invoiceNumber || null,
        })
        .select()
        .single();

      if (dbError) throw dbError;

      // 3. Call edge function to create invoice record
      const { error: linkError } = await supabase.functions.invoke('link-document-invoice', {
        body: {
          document_id: docData.id,
          pipeline_entry_id: pipelineEntryId,
          invoice_type: pendingInvoiceType,
          invoice_amount: amount,
          vendor_name: vendorName || null,
          invoice_number: invoiceNumber || null,
        }
      });

      if (linkError) {
        console.error('Error linking invoice:', linkError);
        // Invoice was uploaded, just show warning
        toast({
          title: 'Document Uploaded',
          description: 'Document saved but invoice tracking may not be linked. Refresh and check Profit Center.',
          variant: 'default',
        });
      } else {
        toast({
          title: 'Invoice Added',
          description: `${pendingInvoiceType === 'material' ? 'Material' : 'Labor'} invoice for $${amount.toFixed(2)} added to cost tracking`,
        });
      }

      // Reset and close
      setInvoiceDialogOpen(false);
      setPendingInvoiceFile(null);
      setInvoiceAmount('');
      setVendorName('');
      setInvoiceNumber('');
      fetchDocuments();
      onUploadComplete?.();
      
      // Dispatch event to refresh Profit Center panel
      window.dispatchEvent(new CustomEvent('invoice-updated', { 
        detail: { pipelineEntryId } 
      }));

    } catch (error: any) {
      console.error('Invoice upload error:', error);
      toast({
        title: 'Upload Failed',
        description: error.message || 'Failed to upload invoice',
        variant: 'destructive',
      });
    } finally {
      setIsLinkingInvoice(false);
    }
  };

  const handleDownload = async (doc: Document) => {
    try {
      const isExternalUrl = doc.file_path.startsWith('http://') || 
                           doc.file_path.startsWith('https://') || 
                           doc.file_path.startsWith('data:');
      
      if (isExternalUrl) {
        const a = document.createElement('a');
        a.href = doc.file_path;
        a.download = doc.filename;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.click();
        return;
      }
      
      const { data, error } = await supabase.storage
        .from('documents')
        .download(doc.file_path);

      if (error) throw error;

      const url = URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = doc.filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Download error:', error);
      toast({
        title: 'Download Failed',
        description: 'Failed to download document',
        variant: 'destructive',
      });
    }
  };

  const handleDeleteDocuments = async (docIds: string[], mode: 'delete_only' | 'detach_approvals' | 'cascade_approvals' = 'delete_only'): Promise<{ success: boolean; deleted?: number }> => {
    setIsDeleting(true);
    try {
      const { data, error } = await supabase.functions.invoke('delete-documents', {
        body: { document_ids: docIds, mode }
      });

      // Handle edge function HTTP errors that contain useful response data
      if (error) {
        // FunctionsHttpError contains the response in different ways
        // Try multiple extraction methods
        let errorData: any = null;
        try {
          // Method 1: error.context.body (newer client versions)
          if (error.context?.body) {
            const bodyText = typeof error.context.body === 'string' 
              ? error.context.body 
              : await error.context.body?.text?.();
            if (bodyText) errorData = JSON.parse(bodyText);
          }
          // Method 2: Try parsing from error message if it contains JSON
          if (!errorData && error.message) {
            const jsonMatch = error.message.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              errorData = JSON.parse(jsonMatch[0]);
            }
          }
        } catch {
          // Ignore JSON parse errors
        }

        // If we have blocked_ids from error response, handle the FK conflict
        if (errorData?.blocked_ids?.length > 0 && mode === 'delete_only') {
          setIsDeleting(false);
          const blockedCount = errorData.blocked_ids.length;
          const choice = window.confirm(
            `${blockedCount} document(s) are linked to approved measurements.\n\n` +
            `Click OK to delete the linked approvals too, or Cancel to detach them (keep approvals, remove report link).`
          );
          
          const newMode = choice ? 'cascade_approvals' : 'detach_approvals';
          return handleDeleteDocuments(docIds, newMode);
        }

        console.error('Delete error:', error, 'Extracted data:', errorData);
        toast({
          title: 'Delete Failed',
          description: errorData?.errors?.[0] || error.message || 'Failed to delete documents',
          variant: 'destructive',
        });
        return { success: false };
      }

      if (!data.success && data.blocked_ids?.length > 0) {
        // Documents are blocked by FK - ask user what to do
        const blockedCount = data.blocked_ids.length;
        const choice = window.confirm(
          `${blockedCount} document(s) are linked to approved measurements.\n\n` +
          `Click OK to delete the linked approvals too, or Cancel to detach them (keep approvals, remove report link).`
        );
        
        const newMode = choice ? 'cascade_approvals' : 'detach_approvals';
        return handleDeleteDocuments(docIds, newMode);
      }

      if (data.errors?.length > 0) {
        console.warn('Partial errors during delete:', data.errors);
      }

      const deletedCount = data.docs_deleted || 0;
      if (deletedCount > 0) {
        let description = `${deletedCount} document(s) deleted`;
        if (data.approvals_detached > 0) {
          description += `, ${data.approvals_detached} approval(s) detached`;
        }
        if (data.approvals_deleted > 0) {
          description += `, ${data.approvals_deleted} approval(s) also deleted`;
        }
        toast({
          title: 'Deleted',
          description,
        });
      } else if (data.blocked_ids?.length > 0) {
        toast({
          title: 'Delete Failed',
          description: data.errors?.[0] || 'Documents are linked to approvals',
          variant: 'destructive',
        });
      }

      return { success: data.success, deleted: deletedCount };
    } catch (error: any) {
      // For caught exceptions, try to extract response body from FunctionsHttpError
      let errorData: any = null;
      try {
        if (error?.context?.body) {
          errorData = JSON.parse(error.context.body);
        }
      } catch {
        // Ignore JSON parse errors
      }

      // If we have blocked_ids from error response, handle the FK conflict
      if (errorData?.blocked_ids?.length > 0) {
        const blockedCount = errorData.blocked_ids.length;
        const choice = window.confirm(
          `${blockedCount} document(s) are linked to approved measurements.\n\n` +
          `Click OK to delete the linked approvals too, or Cancel to detach them (keep approvals, remove report link).`
        );
        
        const newMode = choice ? 'cascade_approvals' : 'detach_approvals';
        return handleDeleteDocuments(docIds, newMode);
      }

      console.error('Delete error:', error);
      toast({
        title: 'Delete Failed',
        description: errorData?.errors?.[0] || error.message || 'Failed to delete documents',
        variant: 'destructive',
      });
      return { success: false };
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDelete = async (docId: string, _filePath: string) => {
    if (!confirm('Are you sure you want to delete this document?')) return;

    const result = await handleDeleteDocuments([docId]);
    if (result.success) {
      setSelectedDocs(prev => {
        const next = new Set(prev);
        next.delete(docId);
        return next;
      });
      fetchDocuments();
      onUploadComplete?.();
    }
  };

  const handleBulkDelete = async () => {
    if (selectedDocs.size === 0) return;
    if (!confirm(`Delete ${selectedDocs.size} document(s)? This cannot be undone.`)) return;

    const result = await handleDeleteDocuments(Array.from(selectedDocs));
    if (result.success || (result.deleted && result.deleted > 0)) {
      setSelectedDocs(new Set());
      fetchDocuments();
      onUploadComplete?.();
    }
  };

  const toggleDocSelection = (docId: string) => {
    setSelectedDocs(prev => {
      const next = new Set(prev);
      if (next.has(docId)) {
        next.delete(docId);
      } else {
        next.add(docId);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedDocs.size === displayedDocuments.length) {
      setSelectedDocs(new Set());
    } else {
      setSelectedDocs(new Set(displayedDocuments.map(d => d.id)));
    }
  };

  const getCategoryIcon = (type: string | null) => {
    const category = DOCUMENT_CATEGORIES.find(c => c.value === type);
    return category?.icon || File;
  };

  const formatFileSize = (bytes: number | null | undefined) => {
    if (bytes === null || bytes === undefined || isNaN(bytes)) return 'Unknown size';
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  return (
    <div className="space-y-6">
      {/* Upload Section with Category Counters */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Upload Document
          </CardTitle>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => setAddSmartDocOpen(true)}
            className="shrink-0"
          >
            <Sparkles className="h-4 w-4 mr-2" />
            Add Smart Doc
          </Button>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {DOCUMENT_CATEGORIES.map((category) => {
              const Icon = category.icon;
              const count = categoryCounts[category.value] || 0;
              const isInvoiceCategory = category.tracksCost;
              const invoiceType = category.value === 'invoice_material' ? 'material' : 
                                 category.value === 'invoice_labor' ? 'labor' : null;
              
              return (
                <label
                  key={category.value}
                  className="cursor-pointer group"
                >
                  <input
                    type="file"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        if (isInvoiceCategory && invoiceType) {
                          handleInvoiceFileSelect(file, invoiceType);
                        } else {
                          handleFileUpload(file, category.value);
                        }
                      }
                      e.target.value = ''; // Reset input
                    }}
                    disabled={uploading || isLinkingInvoice}
                  />
                  <Card className="hover:border-primary transition-colors relative">
                    <CardContent className="flex flex-col items-center justify-center p-6 space-y-2">
                      <div className={`${category.color} text-white p-3 rounded-lg relative`}>
                        <Icon className="h-6 w-6" />
                        {isInvoiceCategory && (
                          <DollarSign className="absolute -top-1 -right-1 h-3 w-3" />
                        )}
                        {count > 0 && (
                          <Badge 
                            variant="secondary" 
                            className="absolute -top-2 -right-2 h-5 min-w-5 px-1 flex items-center justify-center text-xs"
                          >
                            {count}
                          </Badge>
                        )}
                      </div>
                      <span className="text-sm font-medium text-center">{category.label}</span>
                      {isInvoiceCategory && (
                        <span className="text-xs text-muted-foreground">Tracks cost</span>
                      )}
                    </CardContent>
                  </Card>
                </label>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Search and Filters */}
      <DocumentSearchFilters
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        categoryFilter={categoryFilter}
        onCategoryChange={setCategoryFilter}
        dateFrom={dateFrom}
        dateTo={dateTo}
        onDateFromChange={setDateFrom}
        onDateToChange={setDateTo}
        uploaderFilter={uploaderFilter}
        onUploaderChange={setUploaderFilter}
        uploaders={uploaders}
        categories={DOCUMENT_CATEGORIES}
        resultCount={filteredDocuments.length}
        totalCount={documents.length}
      />

      {/* Recent Documents */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h3 className="text-lg font-semibold">Recent Documents</h3>
            {selectedDocs.size > 0 && (
              <Badge variant="secondary">{selectedDocs.size} selected</Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            {selectedDocs.size > 0 && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSelectedDocs(new Set())}
                >
                  <X className="h-4 w-4 mr-1" />
                  Clear
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleBulkDelete}
                  disabled={isDeleting}
                >
                  <Trash2 className="h-4 w-4 mr-1" />
                  Delete {selectedDocs.size}
                </Button>
              </>
            )}
            {filteredDocuments.length > RECENT_DOCS_LIMIT && (
              <Button 
                variant="link" 
                onClick={() => setShowAllDocs(!showAllDocs)}
                className="text-sm"
              >
                {showAllDocs ? 'Show Less' : `View All (${filteredDocuments.length})`}
              </Button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="text-center py-12">Loading documents...</div>
        ) : displayedDocuments.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <FileText className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-muted-foreground">
                {documents.length === 0 
                  ? 'No documents uploaded yet'
                  : 'No documents match your filters'
                }
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4">
            {displayedDocuments.length > 0 && (
              <div className="flex items-center gap-2 px-4 py-2 bg-muted/50 rounded-lg">
                <Checkbox
                  checked={selectedDocs.size === displayedDocuments.length && displayedDocuments.length > 0}
                  onCheckedChange={toggleSelectAll}
                  aria-label="Select all documents"
                />
                <span className="text-sm text-muted-foreground">
                  Select all ({displayedDocuments.length})
                </span>
              </div>
            )}
            {displayedDocuments.map((doc) => {
              const Icon = getCategoryIcon(doc.document_type);
              const category = DOCUMENT_CATEGORIES.find(c => c.value === doc.document_type);
              const isSelected = selectedDocs.has(doc.id);
              
              return (
                <Card key={doc.id} className={isSelected ? 'ring-2 ring-primary' : ''}>
                  <CardContent className="flex items-center justify-between p-4">
                    <div className="flex items-center gap-4 flex-1">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleDocSelection(doc.id)}
                        aria-label={`Select ${doc.filename}`}
                      />
                      <div 
                        className="flex items-center gap-4 flex-1 cursor-pointer hover:opacity-80"
                        onClick={() => setPreviewDoc(doc)}
                      >
                        <div className={`${category?.color || 'bg-gray-500'} text-white p-3 rounded-lg`}>
                          <Icon className="h-5 w-5" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{doc.filename}</p>
                          <div className="flex items-center gap-3 text-sm text-muted-foreground">
                            <Badge variant="outline">{category?.label || 'Other'}</Badge>
                            <span>{formatFileSize(doc.file_size)}</span>
                            <span>{formatDistanceToNow(new Date(doc.created_at), { addSuffix: true })}</span>
                            {doc.uploader && (
                              <span>
                                by {doc.uploader.first_name} {doc.uploader.last_name}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setPreviewDoc(doc)}
                        title="Preview"
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleDownload(doc)}
                        title="Download"
                      >
                        <Download className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => handleDelete(doc.id, doc.file_path)}
                        className="text-destructive"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* Preview Modal - show only the selected document, not all filtered */}
      <DocumentPreviewModal
        document={previewDoc}
        documents={previewDoc ? [previewDoc] : []}
        isOpen={!!previewDoc}
        onClose={() => setPreviewDoc(null)}
        onDownload={handleDownload}
      />

      {/* Invoice Amount Dialog */}
      <Dialog open={invoiceDialogOpen} onOpenChange={(open) => {
        if (!isLinkingInvoice) {
          setInvoiceDialogOpen(open);
          if (!open) setPendingInvoiceFile(null);
        }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {pendingInvoiceType === 'material' ? <Package className="h-5 w-5" /> : <Wrench className="h-5 w-5" />}
              Add {pendingInvoiceType === 'material' ? 'Material' : 'Labor'} Invoice
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="text-sm text-muted-foreground">
              <strong>File:</strong> {pendingInvoiceFile?.name}
            </div>
            <div className="space-y-2">
              <Label htmlFor="invoice-amount">Invoice Amount *</Label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="invoice-amount"
                  type="text"
                  placeholder="0.00"
                  value={invoiceAmount}
                  onChange={(e) => setInvoiceAmount(e.target.value)}
                  className="pl-9"
                  autoFocus
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="vendor-name">{pendingInvoiceType === 'material' ? 'Vendor Name' : 'Crew Name'}</Label>
              <Input
                id="vendor-name"
                type="text"
                placeholder={pendingInvoiceType === 'material' ? 'ABC Supply, etc.' : 'Crew name'}
                value={vendorName}
                onChange={(e) => setVendorName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invoice-number">Invoice Number</Label>
              <Input
                id="invoice-number"
                type="text"
                placeholder="INV-001"
                value={invoiceNumber}
                onChange={(e) => setInvoiceNumber(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInvoiceDialogOpen(false)} disabled={isLinkingInvoice}>
              Cancel
            </Button>
            <Button onClick={handleInvoiceUploadComplete} disabled={isLinkingInvoice || !invoiceAmount}>
              {isLinkingInvoice ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Uploading...
                </>
              ) : (
                'Add Invoice'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Smart Doc Dialog */}
      <AddSmartDocToProjectDialog
        open={addSmartDocOpen}
        onOpenChange={setAddSmartDocOpen}
        pipelineEntryId={pipelineEntryId}
        onDocumentAdded={() => {
          fetchDocuments();
          onUploadComplete?.();
        }}
      />
    </div>
  );
};
