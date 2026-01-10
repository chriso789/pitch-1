import { useState, useCallback } from 'react';
import { Upload, X, Image as ImageIcon, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';

interface LogoUploaderProps {
  logoUrl: string | null;
  onLogoUploaded: (url: string) => void;
  onLogoRemoved: () => void;
  className?: string;
  /** Override the tenant folder for uploads - use when editing a specific company */
  tenantIdOverride?: string;
}

export function LogoUploader({ logoUrl, onLogoUploaded, onLogoRemoved, className, tenantIdOverride }: LogoUploaderProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const effectiveTenantId = useEffectiveTenantId();
  // Use override if provided, otherwise fall back to effective tenant
  const tenantId = tenantIdOverride || effectiveTenantId;

  const handleUpload = useCallback(async (file: File) => {
    // Validate file type
    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/svg+xml', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      toast({
        title: 'Invalid file type',
        description: 'Please upload a PNG, JPG, SVG, or WebP image',
        variant: 'destructive'
      });
      return;
    }

    // Validate file size (2MB max)
    if (file.size > 2 * 1024 * 1024) {
      toast({
        title: 'File too large',
        description: 'Logo must be under 2MB',
        variant: 'destructive'
      });
      return;
    }

    if (!tenantId) {
      toast({
        title: 'Upload failed',
        description: 'No active company selected. Please select a company first.',
        variant: 'destructive'
      });
      return;
    }

    setIsUploading(true);

    try {
      const fileExt = file.name.split('.').pop()?.toLowerCase() || 'png';
      const fileName = `${tenantId}/${crypto.randomUUID()}.${fileExt}`;

      const { error: uploadError } = await supabase.storage
        .from('company-logos')
        .upload(fileName, file, {
          cacheControl: '3600',
          upsert: true
        });

      if (uploadError) {
        // Show the actual error - no fallback to non-existent bucket
        console.error('Logo upload error:', uploadError);
        throw new Error(uploadError.message || 'Storage upload failed');
      }

      const { data: urlData } = supabase.storage
        .from('company-logos')
        .getPublicUrl(fileName);

      onLogoUploaded(urlData.publicUrl);

      toast({
        title: 'Logo uploaded',
        description: 'Company logo has been uploaded successfully'
      });
    } catch (error: any) {
      console.error('Logo upload error:', {
        tenantId,
        tenantIdOverride,
        effectiveTenantId: tenantId,
        error
      });
      toast({
        title: 'Upload failed',
        description: error.message || 'Failed to upload logo. Please try again.',
        variant: 'destructive'
      });
    } finally {
      setIsUploading(false);
    }
  }, [onLogoUploaded, tenantId]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    
    const file = e.dataTransfer.files[0];
    if (file) {
      handleUpload(file);
    }
  }, [handleUpload]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleUpload(file);
    }
  }, [handleUpload]);

  if (logoUrl) {
    return (
      <div className={cn("relative inline-block", className)}>
        <div className="relative w-32 h-32 rounded-lg border-2 border-border overflow-hidden bg-muted">
          <img 
            src={logoUrl} 
            alt="Company logo" 
            className="w-full h-full object-contain p-2"
          />
          <Button
            variant="destructive"
            size="icon"
            className="absolute top-1 right-1 h-6 w-6"
            onClick={onLogoRemoved}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-2 text-center">Logo uploaded</p>
      </div>
    );
  }

  return (
    <div className={className}>
      <label
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={cn(
          "flex flex-col items-center justify-center w-full h-40 border-2 border-dashed rounded-lg cursor-pointer transition-colors",
          isDragOver 
            ? "border-primary bg-primary/5" 
            : "border-border hover:border-primary/50 hover:bg-muted/50",
          isUploading && "pointer-events-none opacity-50"
        )}
      >
        <input
          type="file"
          accept="image/png,image/jpeg,image/jpg,image/svg+xml,image/webp"
          onChange={handleFileSelect}
          className="hidden"
          disabled={isUploading}
        />
        
        {isUploading ? (
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="h-10 w-10 text-primary animate-spin" />
            <span className="text-sm text-muted-foreground">Uploading...</span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <div className="p-3 rounded-full bg-muted">
              {isDragOver ? (
                <Upload className="h-8 w-8 text-primary" />
              ) : (
                <ImageIcon className="h-8 w-8 text-muted-foreground" />
              )}
            </div>
            <div className="text-center">
              <p className="text-sm font-medium">
                {isDragOver ? 'Drop logo here' : 'Drag & drop logo'}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                or click to browse
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              PNG, JPG, SVG, WebP (max 2MB)
            </p>
          </div>
        )}
      </label>
    </div>
  );
}
