import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  FileText, Download, Trash2, Upload, 
  File, Image as ImageIcon, FileCheck, FileLock 
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { formatDistanceToNow } from 'date-fns';

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

export const DocumentsTab: React.FC<DocumentsTabProps> = ({ 
  pipelineEntryId,
  onUploadComplete 
}) => {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [uploading, setUploading] = useState(false);
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

  const filteredDocuments = selectedCategory === 'all' 
    ? documents 
    : documents.filter(doc => doc.document_type === selectedCategory);

  const getCategoryIcon = (type: string | null) => {
    const category = DOCUMENT_CATEGORIES.find(c => c.value === type);
    return category?.icon || File;
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  return (
    <div className="space-y-6">
      {/* Category Filter */}
      <div className="flex flex-wrap gap-2">
        <Button
          variant={selectedCategory === 'all' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setSelectedCategory('all')}
        >
          All Documents ({documents.length})
        </Button>
        {DOCUMENT_CATEGORIES.map((category) => {
          const count = documents.filter(d => d.document_type === category.value).length;
          const Icon = category.icon;
          return (
            <Button
              key={category.value}
              variant={selectedCategory === category.value ? 'default' : 'outline'}
              size="sm"
              onClick={() => setSelectedCategory(category.value)}
              className="flex items-center gap-2"
            >
              <Icon className="h-4 w-4" />
              {category.label} ({count})
            </Button>
          );
        })}
      </div>

      {/* Upload Section */}
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
                  <Card className="hover:border-primary transition-colors">
                    <CardContent className="flex flex-col items-center justify-center p-6 space-y-2">
                      <div className={`${category.color} text-white p-3 rounded-lg`}>
                        <Icon className="h-6 w-6" />
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

      {/* Documents List */}
      {loading ? (
        <div className="text-center py-12">Loading documents...</div>
      ) : filteredDocuments.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FileText className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-muted-foreground">
              {selectedCategory === 'all' 
                ? 'No documents uploaded yet'
                : `No ${DOCUMENT_CATEGORIES.find(c => c.value === selectedCategory)?.label} uploaded yet`
              }
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {filteredDocuments.map((doc) => {
            const Icon = getCategoryIcon(doc.document_type);
            const category = DOCUMENT_CATEGORIES.find(c => c.value === doc.document_type);
            
            return (
              <Card key={doc.id}>
                <CardContent className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-4 flex-1">
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
                      onClick={() => handleDownload(doc)}
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => handleDelete(doc.id, doc.file_path)}
                      className="text-destructive"
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
  );
};
