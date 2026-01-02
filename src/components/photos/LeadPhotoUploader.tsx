import React, { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { 
  Upload, 
  Camera, 
  X, 
  Image as ImageIcon,
  Loader2,
  CheckCircle
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/components/ui/use-toast';

interface LeadPhotoUploaderProps {
  pipelineEntryId: string;
  onUploadComplete?: () => void;
}

type PhotoCategory = 'before' | 'after' | 'damage' | 'materials' | 'inspection';

const CATEGORY_COLORS: Record<PhotoCategory, string> = {
  before: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  after: 'bg-green-500/10 text-green-600 border-green-500/20',
  damage: 'bg-red-500/10 text-red-600 border-red-500/20',
  materials: 'bg-orange-500/10 text-orange-600 border-orange-500/20',
  inspection: 'bg-purple-500/10 text-purple-600 border-purple-500/20'
};

const CATEGORY_LABELS: Record<PhotoCategory, string> = {
  before: 'Before',
  after: 'After',
  damage: 'Damage',
  materials: 'Materials',
  inspection: 'Inspection'
};

interface PendingUpload {
  file: File;
  category: PhotoCategory;
  preview: string;
}

export const LeadPhotoUploader: React.FC<LeadPhotoUploaderProps> = ({
  pipelineEntryId,
  onUploadComplete
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  // Auto-detect category based on filename
  const detectCategory = (filename: string): PhotoCategory => {
    const lowerName = filename.toLowerCase();
    
    if (lowerName.includes('before') || lowerName.includes('initial') || lowerName.includes('pre')) {
      return 'before';
    }
    if (lowerName.includes('after') || lowerName.includes('completed') || lowerName.includes('final') || lowerName.includes('post')) {
      return 'after';
    }
    if (lowerName.includes('damage') || lowerName.includes('issue') || lowerName.includes('problem') || lowerName.includes('broken')) {
      return 'damage';
    }
    if (lowerName.includes('material') || lowerName.includes('delivery') || lowerName.includes('supply')) {
      return 'materials';
    }
    return 'inspection';
  };

  const handleFiles = useCallback((files: FileList | File[]) => {
    const fileArray = Array.from(files);
    const imageFiles = fileArray.filter(file => file.type.startsWith('image/'));
    
    if (imageFiles.length === 0) {
      toast({
        title: "Invalid files",
        description: "Please upload image files only",
        variant: "destructive"
      });
      return;
    }

    const newUploads: PendingUpload[] = imageFiles.map(file => ({
      file,
      category: detectCategory(file.name),
      preview: URL.createObjectURL(file)
    }));

    setPendingUploads(prev => [...prev, ...newUploads]);
  }, []);

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
    handleFiles(e.dataTransfer.files);
  }, [handleFiles]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleFiles(e.target.files);
    }
  }, [handleFiles]);

  const removeUpload = (index: number) => {
    setPendingUploads(prev => {
      const newUploads = [...prev];
      URL.revokeObjectURL(newUploads[index].preview);
      newUploads.splice(index, 1);
      return newUploads;
    });
  };

  const updateCategory = (index: number, category: PhotoCategory) => {
    setPendingUploads(prev => {
      const newUploads = [...prev];
      newUploads[index] = { ...newUploads[index], category };
      return newUploads;
    });
  };

  const uploadPhotos = async () => {
    if (pendingUploads.length === 0) return;

    setIsUploading(true);
    let successCount = 0;

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('id', user.id)
        .single();

      if (!profile?.tenant_id) throw new Error("No tenant found");

      for (const upload of pendingUploads) {
        try {
          const fileExt = upload.file.name.split('.').pop();
          const fileName = `${pipelineEntryId}/${upload.category}/${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
          
          // Upload to storage
          const { error: uploadError } = await supabase.storage
            .from('documents')
            .upload(fileName, upload.file);

          if (uploadError) {
            console.error('Upload error:', uploadError);
            continue;
          }

          // Get public URL
          const { data: { publicUrl } } = supabase.storage
            .from('documents')
            .getPublicUrl(fileName);

          // Save to documents table (photos are stored here)
          const { error: dbError } = await supabase
            .from('documents')
            .insert({
              tenant_id: profile.tenant_id,
              pipeline_entry_id: pipelineEntryId,
              file_path: fileName,
              filename: upload.file.name,
              document_type: `photo_${upload.category}`,
              mime_type: upload.file.type,
              file_size: upload.file.size,
              uploaded_by: user.id
            });

          if (dbError) {
            console.error('DB error:', dbError);
            continue;
          }

          successCount++;
        } catch (err) {
          console.error('Error uploading file:', err);
        }
      }

      // Clear pending uploads
      pendingUploads.forEach(u => URL.revokeObjectURL(u.preview));
      setPendingUploads([]);

      toast({
        title: "Photos uploaded",
        description: `Successfully uploaded ${successCount} of ${pendingUploads.length} photos`
      });

      onUploadComplete?.();
    } catch (error) {
      console.error('Upload error:', error);
      toast({
        title: "Upload failed",
        description: "An error occurred while uploading photos",
        variant: "destructive"
      });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Camera className="h-4 w-4" />
          Upload Photos
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Drop Zone */}
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={cn(
            "border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer",
            isDragging 
              ? "border-primary bg-primary/5" 
              : "border-muted-foreground/25 hover:border-primary/50"
          )}
          onClick={() => document.getElementById('photo-input')?.click()}
        >
          <input
            id="photo-input"
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleFileInput}
          />
          <Upload className={cn(
            "h-8 w-8 mx-auto mb-2",
            isDragging ? "text-primary" : "text-muted-foreground"
          )} />
          <p className="text-sm font-medium">
            {isDragging ? "Drop photos here" : "Drag photos here or click to browse"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Supports JPG, PNG, HEIC
          </p>
          
          {/* Category hints */}
          <div className="flex justify-center gap-2 mt-3 flex-wrap">
            {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
              <Badge 
                key={key} 
                variant="outline" 
                className={cn("text-[10px]", CATEGORY_COLORS[key as PhotoCategory])}
              >
                {label}
              </Badge>
            ))}
          </div>
        </div>

        {/* Pending Uploads */}
        {pendingUploads.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">
                {pendingUploads.length} photo{pendingUploads.length !== 1 ? 's' : ''} ready
              </span>
              <Button
                size="sm"
                onClick={uploadPhotos}
                disabled={isUploading}
              >
                {isUploading ? (
                  <>
                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  <>
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Upload All
                  </>
                )}
              </Button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {pendingUploads.map((upload, index) => (
                <div 
                  key={index} 
                  className="relative group rounded-lg overflow-hidden border bg-muted"
                >
                  <div className="aspect-square">
                    <img 
                      src={upload.preview} 
                      alt={`Upload ${index + 1}`}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  
                  {/* Remove button */}
                  <button
                    onClick={() => removeUpload(index)}
                    className="absolute top-1 right-1 bg-background/80 rounded-full p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="h-3 w-3" />
                  </button>
                  
                  {/* Category selector */}
                  <div className="absolute bottom-0 left-0 right-0 p-1.5 bg-gradient-to-t from-black/60 to-transparent">
                    <Select
                      value={upload.category}
                      onValueChange={(value) => updateCategory(index, value as PhotoCategory)}
                    >
                      <SelectTrigger className="h-6 text-[10px] bg-background/80 border-0">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                          <SelectItem key={key} value={key} className="text-xs">
                            {label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
};
