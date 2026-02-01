// ============================================================
// Scope Uploader Component
// Drag-drop PDF upload with progress tracking
// ============================================================

import React, { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Upload, FileText, CheckCircle, AlertCircle, Loader2, X } from 'lucide-react';
import { useUploadScope } from '@/hooks/useScopeIntelligence';
import { DOCUMENT_TYPE_LABELS, getParseStatusInfo } from '@/lib/insurance/canonicalItems';
import { cn } from '@/lib/utils';

interface ScopeUploaderProps {
  insuranceClaimId?: string;
  jobId?: string;
  onUploadComplete?: (documentId: string) => void;
  className?: string;
}

type DocumentType = 'estimate' | 'supplement' | 'denial' | 'policy' | 'reinspection' | 'final_settlement';

interface UploadedFile {
  file: File;
  status: 'pending' | 'uploading' | 'processing' | 'complete' | 'error';
  progress: number;
  documentId?: string;
  error?: string;
}

export const ScopeUploader: React.FC<ScopeUploaderProps> = ({
  insuranceClaimId,
  jobId,
  onUploadComplete,
  className,
}) => {
  const [documentType, setDocumentType] = useState<DocumentType>('estimate');
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const uploadMutation = useUploadScope();

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const newFiles: UploadedFile[] = acceptedFiles.map(file => ({
      file,
      status: 'pending',
      progress: 0,
    }));
    setUploadedFiles(prev => [...prev, ...newFiles]);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
    },
    maxSize: 50 * 1024 * 1024, // 50MB
    multiple: true,
  });

  const startUpload = async (index: number) => {
    const fileEntry = uploadedFiles[index];
    if (!fileEntry || fileEntry.status !== 'pending') return;

    // Update status to uploading
    setUploadedFiles(prev => prev.map((f, i) => 
      i === index ? { ...f, status: 'uploading', progress: 20 } : f
    ));

    try {
      // Simulate progress updates
      const progressInterval = setInterval(() => {
        setUploadedFiles(prev => prev.map((f, i) => 
          i === index && f.status === 'uploading' 
            ? { ...f, progress: Math.min(f.progress + 10, 60) } 
            : f
        ));
      }, 500);

      const result = await uploadMutation.mutateAsync({
        file: fileEntry.file,
        documentType,
        insuranceClaimId,
        jobId,
      });

      clearInterval(progressInterval);

      // Update to processing
      setUploadedFiles(prev => prev.map((f, i) => 
        i === index ? { ...f, status: 'processing', progress: 80 } : f
      ));

      // Simulate processing completion
      setTimeout(() => {
        setUploadedFiles(prev => prev.map((f, i) => 
          i === index ? { 
            ...f, 
            status: 'complete', 
            progress: 100,
            documentId: result.document_id 
          } : f
        ));
        if (onUploadComplete && result.document_id) {
          onUploadComplete(result.document_id);
        }
      }, 1000);

    } catch (error) {
      setUploadedFiles(prev => prev.map((f, i) => 
        i === index ? { 
          ...f, 
          status: 'error', 
          error: error instanceof Error ? error.message : 'Upload failed' 
        } : f
      ));
    }
  };

  const removeFile = (index: number) => {
    setUploadedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const uploadAll = () => {
    uploadedFiles.forEach((file, index) => {
      if (file.status === 'pending') {
        startUpload(index);
      }
    });
  };

  const pendingCount = uploadedFiles.filter(f => f.status === 'pending').length;
  const hasFiles = uploadedFiles.length > 0;

  return (
    <Card className={cn("w-full", className)}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          Upload Insurance Scope
        </CardTitle>
        <CardDescription>
          Upload insurance estimate PDFs to extract line items and build your evidence vault
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Document Type Selector */}
        <div className="flex items-center gap-4">
          <label className="text-sm font-medium">Document Type:</label>
          <Select value={documentType} onValueChange={(v) => setDocumentType(v as DocumentType)}>
            <SelectTrigger className="w-[200px]">
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
            "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors",
            isDragActive 
              ? "border-primary bg-primary/5" 
              : "border-muted-foreground/25 hover:border-primary/50"
          )}
        >
          <input {...getInputProps()} />
          <Upload className="h-10 w-10 mx-auto mb-4 text-muted-foreground" />
          {isDragActive ? (
            <p className="text-lg font-medium text-primary">Drop PDF files here...</p>
          ) : (
            <>
              <p className="text-lg font-medium">Drag & drop insurance scope PDFs</p>
              <p className="text-sm text-muted-foreground mt-1">
                or click to browse (max 50MB per file)
              </p>
            </>
          )}
        </div>

        {/* File List */}
        {hasFiles && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium">Files ({uploadedFiles.length})</h4>
              {pendingCount > 0 && (
                <Button size="sm" onClick={uploadAll}>
                  Upload All ({pendingCount})
                </Button>
              )}
            </div>
            
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {uploadedFiles.map((fileEntry, index) => (
                <div 
                  key={`${fileEntry.file.name}-${index}`}
                  className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg"
                >
                  <FileText className="h-8 w-8 text-muted-foreground shrink-0" />
                  
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{fileEntry.file.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {(fileEntry.file.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                    
                    {(fileEntry.status === 'uploading' || fileEntry.status === 'processing') && (
                      <div className="mt-2">
                        <Progress value={fileEntry.progress} className="h-1.5" />
                        <p className="text-xs text-muted-foreground mt-1">
                          {fileEntry.status === 'uploading' ? 'Uploading...' : 'Processing...'}
                        </p>
                      </div>
                    )}
                    
                    {fileEntry.status === 'error' && (
                      <p className="text-xs text-destructive mt-1">{fileEntry.error}</p>
                    )}
                  </div>

                  <div className="shrink-0">
                    {fileEntry.status === 'pending' && (
                      <Button 
                        size="sm" 
                        variant="outline"
                        onClick={() => startUpload(index)}
                      >
                        Upload
                      </Button>
                    )}
                    
                    {fileEntry.status === 'uploading' && (
                      <Loader2 className="h-5 w-5 animate-spin text-primary" />
                    )}
                    
                    {fileEntry.status === 'processing' && (
                      <Badge variant="secondary" className="animate-pulse">
                        Processing
                      </Badge>
                    )}
                    
                    {fileEntry.status === 'complete' && (
                      <CheckCircle className="h-5 w-5 text-green-600" />
                    )}
                    
                    {fileEntry.status === 'error' && (
                      <AlertCircle className="h-5 w-5 text-destructive" />
                    )}
                    
                    {(fileEntry.status === 'pending' || fileEntry.status === 'error') && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 ml-2"
                        onClick={() => removeFile(index)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Info Section */}
        <div className="text-sm text-muted-foreground bg-muted/30 rounded-lg p-4">
          <h4 className="font-medium mb-2">What happens next:</h4>
          <ol className="list-decimal list-inside space-y-1 text-xs">
            <li>AI extracts text, tables, and line items from the PDF</li>
            <li>Carrier, claim details, and totals are automatically detected</li>
            <li>Line items are mapped to our canonical taxonomy for cross-carrier comparison</li>
            <li>Evidence coordinates are stored for PDF highlighting</li>
            <li>Data becomes searchable for supplement evidence packets</li>
          </ol>
        </div>
      </CardContent>
    </Card>
  );
};

export default ScopeUploader;
