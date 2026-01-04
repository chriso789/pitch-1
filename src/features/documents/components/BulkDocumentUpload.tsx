import React, { useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Upload, X, FileText, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface BulkDocumentUploadProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploadComplete: () => void;
}

interface FileUploadStatus {
  file: File;
  status: "pending" | "uploading" | "success" | "error";
  error?: string;
  progress?: number;
}

export const BulkDocumentUpload: React.FC<BulkDocumentUploadProps> = ({
  open,
  onOpenChange,
  onUploadComplete,
}) => {
  const [files, setFiles] = useState<FileUploadStatus[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [overallProgress, setOverallProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const droppedFiles = Array.from(e.dataTransfer.files);
    addFiles(droppedFiles);
  }, []);

  const addFiles = (newFiles: File[]) => {
    const fileStatuses: FileUploadStatus[] = newFiles.map((file) => ({
      file,
      status: "pending" as const,
    }));
    setFiles((prev) => [...prev, ...fileStatuses]);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (selectedFiles) {
      addFiles(Array.from(selectedFiles));
    }
    e.target.value = ""; // Reset input
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const uploadAllFiles = async () => {
    if (files.length === 0) return;

    setIsUploading(true);
    setOverallProgress(0);

    try {
      // Get user's tenant_id
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error("You must be logged in to upload documents");
        setIsUploading(false);
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("tenant_id")
        .eq("id", user.id)
        .single();

      if (profileError || !profile?.tenant_id) {
        toast.error("Failed to get tenant information");
        setIsUploading(false);
        return;
      }

      const tenantId = profile.tenant_id;
      let completed = 0;

      // Upload files in parallel (max 5 at a time)
      const batchSize = 5;
      for (let i = 0; i < files.length; i += batchSize) {
        const batch = files.slice(i, i + batchSize);
        
        await Promise.all(
          batch.map(async (fileStatus, batchIndex) => {
            const index = i + batchIndex;
            
            // Update status to uploading
            setFiles((prev) => {
              const updated = [...prev];
              updated[index] = { ...updated[index], status: "uploading" };
              return updated;
            });

            try {
              const file = fileStatus.file;
              const fileName = `company-docs/${Date.now()}-${file.name}`;

              // Upload to storage
              const { data: uploadData, error: uploadError } = await supabase.storage
                .from("smartdoc-assets")
                .upload(fileName, file);

              if (uploadError) throw uploadError;

              // Create document record
              const { error: insertError } = await supabase
                .from("documents")
                .insert({
                  filename: file.name,
                  file_path: uploadData.path,
                  file_size: file.size,
                  mime_type: file.type,
                  document_type: "company_resource",
                  description: "Company resource document",
                  tenant_id: tenantId,
                });

              if (insertError) throw insertError;

              // Update status to success
              setFiles((prev) => {
                const updated = [...prev];
                updated[index] = { ...updated[index], status: "success" };
                return updated;
              });
            } catch (error: any) {
              console.error("Error uploading file:", error);
              setFiles((prev) => {
                const updated = [...prev];
                updated[index] = {
                  ...updated[index],
                  status: "error",
                  error: error.message || "Upload failed",
                };
                return updated;
              });
            }

            completed++;
            setOverallProgress(Math.round((completed / files.length) * 100));
          })
        );
      }

      const successCount = files.filter((f) => f.status === "success").length;
      const errorCount = files.filter((f) => f.status === "error").length;

      if (errorCount === 0) {
        toast.success(`Successfully uploaded ${successCount} documents`);
      } else if (successCount > 0) {
        toast.warning(`Uploaded ${successCount} documents, ${errorCount} failed`);
      } else {
        toast.error("All uploads failed");
      }

      onUploadComplete();
    } catch (error) {
      console.error("Bulk upload error:", error);
      toast.error("Bulk upload failed");
    } finally {
      setIsUploading(false);
    }
  };

  const handleClose = () => {
    if (!isUploading) {
      setFiles([]);
      setOverallProgress(0);
      onOpenChange(false);
    }
  };

  const getFileIcon = (status: FileUploadStatus["status"]) => {
    switch (status) {
      case "success":
        return <CheckCircle2 className="h-5 w-5 text-green-500" />;
      case "error":
        return <AlertCircle className="h-5 w-5 text-destructive" />;
      case "uploading":
        return <Loader2 className="h-5 w-5 text-primary animate-spin" />;
      default:
        return <FileText className="h-5 w-5 text-muted-foreground" />;
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Bulk Upload Documents</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Drop Zone */}
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            className={cn(
              "border-2 border-dashed rounded-lg p-8 text-center transition-colors",
              isDragging
                ? "border-primary bg-primary/5"
                : "border-muted-foreground/25 hover:border-primary/50",
              isUploading && "pointer-events-none opacity-50"
            )}
          >
            <Upload className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
            <p className="text-sm text-muted-foreground mb-2">
              Drag and drop files here, or click to select
            </p>
            <input
              type="file"
              id="bulk-file-input"
              className="hidden"
              multiple
              onChange={handleFileSelect}
              accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.jpg,.jpeg,.png"
              disabled={isUploading}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => document.getElementById("bulk-file-input")?.click()}
              disabled={isUploading}
            >
              Select Files
            </Button>
          </div>

          {/* File List */}
          {files.length > 0 && (
            <ScrollArea className="h-[200px] border rounded-lg p-2">
              <div className="space-y-2">
                {files.map((fileStatus, index) => (
                  <div
                    key={`${fileStatus.file.name}-${index}`}
                    className="flex items-center justify-between p-2 bg-muted/50 rounded-md"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      {getFileIcon(fileStatus.status)}
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">
                          {fileStatus.file.name}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {formatFileSize(fileStatus.file.size)}
                          {fileStatus.error && (
                            <span className="text-destructive ml-2">
                              {fileStatus.error}
                            </span>
                          )}
                        </p>
                      </div>
                    </div>
                    {!isUploading && fileStatus.status === "pending" && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => removeFile(index)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          )}

          {/* Progress */}
          {isUploading && (
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Uploading...</span>
                <span>{overallProgress}%</span>
              </div>
              <Progress value={overallProgress} />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isUploading}>
            {isUploading ? "Uploading..." : "Cancel"}
          </Button>
          <Button
            onClick={uploadAllFiles}
            disabled={files.length === 0 || isUploading}
          >
            {isUploading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" />
                Upload {files.length} {files.length === 1 ? "File" : "Files"}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
