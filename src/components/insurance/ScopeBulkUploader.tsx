// ============================================================
// Bulk Upload Modal for Insurance Scope Documents
// Allows uploading multiple PDFs at once with batch processing
// ============================================================

import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { 
  Upload, 
  FileText, 
  CheckCircle, 
  AlertCircle, 
  Loader2, 
  X,
  File
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { useToast } from '@/hooks/use-toast';
import { useQueryClient } from '@tanstack/react-query';
import { DOCUMENT_TYPE_LABELS } from '@/lib/insurance/canonicalItems';

// ============================================================
// Types
// ============================================================

interface ScopeBulkUploaderProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploadComplete: () => void;
}

interface FileUploadStatus {
  file: File;
  id: string;
  status: 'pending' | 'uploading' | 'processing' | 'success' | 'error';
  error?: string;
  documentId?: string;
}

type DocumentType = 'estimate' | 'supplement' | 'final_settlement' | 'denial' | 'policy' | 'reinspection';

// ============================================================
// Component
// ============================================================

export const ScopeBulkUploader: React.FC<ScopeBulkUploaderProps> = ({
  open,
  onOpenChange,
  onUploadComplete,
}) => {
  const [files, setFiles] = useState<FileUploadStatus[]>([]);
  const [documentType, setDocumentType] = useState<DocumentType>('estimate');
  const [isUploading, setIsUploading] = useState(false);
  const tenantId = useEffectiveTenantId();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Calculate progress
  const completedFiles = files.filter(f => f.status === 'success' || f.status === 'error').length;
  const progressPercent = files.length > 0 ? (completedFiles / files.length) * 100 : 0;
  const successCount = files.filter(f => f.status === 'success').length;
  const errorCount = files.filter(f => f.status === 'error').length;

  // Dropzone configuration
  const onDrop = useCallback((acceptedFiles: File[]) => {
    const newFiles: FileUploadStatus[] = acceptedFiles.map(file => ({
      file,
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      status: 'pending',
    }));
    setFiles(prev => [...prev, ...newFiles]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
    },
    maxSize: 50 * 1024 * 1024, // 50MB
    disabled: isUploading,
  });

  // Remove a file from the list
  const removeFile = (id: string) => {
    setFiles(prev => prev.filter(f => f.id !== id));
  };

  // Process a single file
  const processFile = async (fileStatus: FileUploadStatus): Promise<void> => {
    const { file, id } = fileStatus;
    
    // Update status to uploading
    setFiles(prev => prev.map(f => 
      f.id === id ? { ...f, status: 'uploading' } : f
    ));

    try {
      // Upload to storage
      const storagePath = `insurance-scopes/${tenantId}/${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from('documents')
        .upload(storagePath, file, {
          contentType: file.type,
        });

      if (uploadError) throw uploadError;

      // Update status to processing
      setFiles(prev => prev.map(f => 
        f.id === id ? { ...f, status: 'processing' } : f
      ));

      // Call ingestion function
      const { data, error } = await supabase.functions.invoke('scope-document-ingest', {
        body: {
          storage_path: storagePath,
          document_type: documentType,
          file_name: file.name,
        },
      });

      if (error) throw error;

      // Update status to success
      setFiles(prev => prev.map(f => 
        f.id === id ? { ...f, status: 'success', documentId: data?.document_id } : f
      ));
    } catch (error) {
      console.error('Upload error for file:', file.name, error);
      setFiles(prev => prev.map(f => 
        f.id === id ? { 
          ...f, 
          status: 'error', 
          error: error instanceof Error ? error.message : 'Upload failed' 
        } : f
      ));
    }
  };

  // Start bulk upload with batch processing
  const startUpload = async () => {
    if (!tenantId || files.length === 0) return;

    setIsUploading(true);
    const pendingFiles = files.filter(f => f.status === 'pending');
    const batchSize = 5;

    try {
      for (let i = 0; i < pendingFiles.length; i += batchSize) {
        const batch = pendingFiles.slice(i, i + batchSize);
        await Promise.all(batch.map(processFile));
      }

      // Invalidate queries to refresh document list
      queryClient.invalidateQueries({ queryKey: ['scope-documents'] });
      queryClient.invalidateQueries({ queryKey: ['scope-documents-filtered'] });

      // Show summary toast
      const finalSuccessCount = files.filter(f => f.status === 'success').length + 
        pendingFiles.filter(f => f.status !== 'error').length;
      const finalErrorCount = files.filter(f => f.status === 'error').length;

      if (finalErrorCount === 0) {
        toast({
          title: 'Upload complete',
          description: `Successfully uploaded ${pendingFiles.length} documents`,
        });
        onUploadComplete();
      } else {
        toast({
          title: 'Upload finished with errors',
          description: `${finalSuccessCount} succeeded, ${finalErrorCount} failed`,
          variant: 'destructive',
        });
      }
    } finally {
      setIsUploading(false);
    }
  };

  // Reset state when dialog closes
  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen && !isUploading) {
      setFiles([]);
      setDocumentType('estimate');
    }
    onOpenChange(newOpen);
  };

  // Format file size
  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Get status icon for a file
  const getStatusIcon = (status: FileUploadStatus['status']) => {
    switch (status) {
      case 'pending':
        return <File className="h-4 w-4 text-muted-foreground" />;
      case 'uploading':
      case 'processing':
        return <Loader2 className="h-4 w-4 text-primary animate-spin" />;
      case 'success':
        return <CheckCircle className="h-4 w-4 text-primary" />;
      case 'error':
        return <AlertCircle className="h-4 w-4 text-destructive" />;
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Bulk Upload Insurance Scopes
          </DialogTitle>
          <DialogDescription>
            Upload multiple insurance scope PDFs at once. All files will be processed through the AI extraction pipeline.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 flex-1 overflow-hidden flex flex-col min-h-0">
          {/* Document Type Selector */}
          <div className="flex items-center gap-4 shrink-0">
            <label className="text-sm font-medium">Document Type:</label>
            <Select
              value={documentType}
              onValueChange={(v) => setDocumentType(v as DocumentType)}
              disabled={isUploading}
            >
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(DOCUMENT_TYPE_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Dropzone */}
          <div
            {...getRootProps()}
            className={cn(
              'border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors shrink-0',
              isDragActive && 'border-primary bg-primary/5',
              !isDragActive && 'border-border hover:border-primary/50',
              isUploading && 'opacity-50 cursor-not-allowed'
            )}
          >
            <input {...getInputProps()} />
            <FileText className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
            {isDragActive ? (
              <p className="text-primary font-medium">Drop the PDFs here...</p>
            ) : (
              <>
                <p className="font-medium">Drag & drop insurance scope PDFs</p>
                <p className="text-sm text-muted-foreground mt-1">or click to select files</p>
              </>
            )}
            <Button variant="outline" size="sm" className="mt-4" disabled={isUploading}>
              Select Files
            </Button>
          </div>

          {/* File List */}
          {files.length > 0 && (
            <div className="flex-1 min-h-0 flex flex-col">
              <div className="flex items-center justify-between shrink-0 mb-2">
                <p className="text-sm font-medium">Files to upload ({files.length})</p>
                {!isUploading && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setFiles([])}
                    className="text-muted-foreground h-auto py-1 px-2"
                  >
                    Clear all
                  </Button>
                )}
              </div>
              <ScrollArea className="flex-1 min-h-[100px] max-h-[200px] border rounded-lg">
                <div className="p-2 space-y-1">
                  {files.map((fileStatus) => (
                    <div
                      key={fileStatus.id}
                    className={cn(
                        'flex items-center gap-3 p-2 rounded-md text-sm',
                        fileStatus.status === 'error' && 'bg-destructive/10'
                      )}
                    >
                      {getStatusIcon(fileStatus.status)}
                      <div className="flex-1 min-w-0">
                        <p className="truncate font-medium">{fileStatus.file.name}</p>
                        {fileStatus.error && (
                          <p className="text-xs text-destructive truncate">{fileStatus.error}</p>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {formatSize(fileStatus.file.size)}
                      </span>
                      {!isUploading && fileStatus.status === 'pending' && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 shrink-0"
                          onClick={() => removeFile(fileStatus.id)}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}

          {/* Progress Bar */}
          {isUploading && (
            <div className="space-y-2 shrink-0">
              <Progress value={progressPercent} className="h-2" />
              <p className="text-sm text-muted-foreground text-center">
                Processing {completedFiles} of {files.length} files...
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            disabled={isUploading}
          >
            Cancel
          </Button>
          <Button
            onClick={startUpload}
            disabled={files.length === 0 || isUploading || files.every(f => f.status !== 'pending')}
          >
            {isUploading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 mr-2" />
                Upload {files.filter(f => f.status === 'pending').length} Files
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
