import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  FileText, Download, Trash2, Upload, Eye,
  File, Image as ImageIcon, FileCheck, FileLock 
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { formatDistanceToNow, isAfter, isBefore, startOfDay, endOfDay } from 'date-fns';
import { DocumentPreviewModal } from '@/components/documents/DocumentPreviewModal';
import { DocumentSearchFilters } from '@/components/documents/DocumentSearchFilters';

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
  { value: 'contract', label: 'Contracts', icon: FileCheck, color: 'bg-blue-500' },
  { value: 'estimate', label: 'Estimates', icon: FileText, color: 'bg-green-500' },
  { value: 'insurance', label: 'Insurance', icon: FileLock, color: 'bg-purple-500' },
  { value: 'photo', label: 'Photos', icon: ImageIcon, color: 'bg-orange-500' },
  { value: 'permit', label: 'Permits', icon: FileCheck, color: 'bg-red-500' },
  { value: 'other', label: 'Other', icon: File, color: 'bg-gray-500' },
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

  const handleDelete = async (docId: string, filePath: string) => {
    if (!confirm('Are you sure you want to delete this document?')) return;

    try {
      await supabase.storage.from('documents').remove([filePath]);
      await supabase.from('documents').delete().eq('id', docId);

      toast({
        title: 'Deleted',
        description: 'Document deleted successfully',
      });

      fetchDocuments();
      onUploadComplete?.();
    } catch (error) {
      console.error('Delete error:', error);
      toast({
        title: 'Delete Failed',
        description: 'Failed to delete document',
        variant: 'destructive',
      });
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
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Upload Document
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {DOCUMENT_CATEGORIES.map((category) => {
              const Icon = category.icon;
              const count = categoryCounts[category.value] || 0;
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
                      if (file) handleFileUpload(file, category.value);
                    }}
                    disabled={uploading}
                  />
                  <Card className="hover:border-primary transition-colors relative">
                    <CardContent className="flex flex-col items-center justify-center p-6 space-y-2">
                      <div className={`${category.color} text-white p-3 rounded-lg relative`}>
                        <Icon className="h-6 w-6" />
                        {count > 0 && (
                          <Badge 
                            variant="secondary" 
                            className="absolute -top-2 -right-2 h-5 min-w-5 px-1 flex items-center justify-center text-xs"
                          >
                            {count}
                          </Badge>
                        )}
                      </div>
                      <span className="text-sm font-medium">{category.label}</span>
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
          <h3 className="text-lg font-semibold">Recent Documents</h3>
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
            {displayedDocuments.map((doc) => {
              const Icon = getCategoryIcon(doc.document_type);
              const category = DOCUMENT_CATEGORIES.find(c => c.value === doc.document_type);
              
              return (
                <Card key={doc.id}>
                  <CardContent className="flex items-center justify-between p-4">
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

      {/* Preview Modal */}
      <DocumentPreviewModal
        document={previewDoc}
        documents={filteredDocuments}
        isOpen={!!previewDoc}
        onClose={() => setPreviewDoc(null)}
        onDownload={handleDownload}
      />
    </div>
  );
};
