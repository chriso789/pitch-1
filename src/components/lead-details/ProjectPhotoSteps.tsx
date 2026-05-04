import React, { useRef, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Camera, CheckCircle, ImageIcon, Loader2, Upload } from 'lucide-react';
import { compressImage } from '@/lib/imageCompression';
import { cn } from '@/lib/utils';
import { usePhotos, type PhotoCategory, type CustomerPhoto } from '@/hooks/usePhotos';
import { toast } from '@/components/ui/use-toast';

interface ProjectPhotoStepsProps {
  leadId: string;
  contactId?: string;
}

const STEPS: { key: PhotoCategory; label: string; colorClass: string; bgClass: string; borderClass: string }[] = [
  { key: 'before', label: 'Before Photos', colorClass: 'text-blue-600 dark:text-blue-400', bgClass: 'bg-blue-100 dark:bg-blue-900/40', borderClass: 'border-blue-400' },
  { key: 'during', label: 'In Progress Photos', colorClass: 'text-orange-600 dark:text-orange-400', bgClass: 'bg-orange-100 dark:bg-orange-900/40', borderClass: 'border-orange-400' },
  { key: 'after', label: 'Final Photos', colorClass: 'text-green-600 dark:text-green-400', bgClass: 'bg-green-100 dark:bg-green-900/40', borderClass: 'border-green-400' },
];

export function ProjectPhotoSteps({ leadId, contactId }: ProjectPhotoStepsProps) {
  const { photos, uploadPhoto, isUploading } = usePhotos({ leadId, enabled: true });
  const [uploadingCategory, setUploadingCategory] = useState<PhotoCategory | null>(null);
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const getCountForCategory = (category: PhotoCategory) =>
    photos.filter(p => p.category === category).length;

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>, category: PhotoCategory) => {
    const files = e.target.files;
    if (!files?.length) return;

    setUploadingCategory(category);
    try {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/')) continue;
        if (file.size > 10 * 1024 * 1024) {
          toast({ title: 'File too large', description: `${file.name} exceeds 10MB limit`, variant: 'destructive' });
          continue;
        }
        await uploadPhoto({ file, category, leadId, contactId });
      }
      toast({ title: 'Photos uploaded', description: `${category} photos added successfully` });
    } catch (err) {
      console.error('Upload error:', err);
      toast({ title: 'Upload failed', description: 'Could not upload one or more photos', variant: 'destructive' });
    } finally {
      setUploadingCategory(null);
      if (fileInputRefs.current[category]) {
        fileInputRefs.current[category]!.value = '';
      }
    }
  };

  return (
    <Card className="border-primary/20">
      <CardHeader className="p-4">
        <CardTitle className="flex items-center space-x-2 text-base">
          <Camera className="h-4 w-4 text-primary" />
          <span>Project Photo Documentation</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        <div className="relative flex flex-col gap-0">
          {STEPS.map((step, idx) => {
            const count = getCountForCategory(step.key);
            const isActive = uploadingCategory === step.key;
            const isComplete = count > 0;

            return (
              <div key={step.key} className="flex items-start gap-3">
                {/* Stepper line + circle */}
                <div className="flex flex-col items-center">
                  <div className={cn(
                    'w-8 h-8 rounded-full flex items-center justify-center border-2 shrink-0 transition-colors',
                    isComplete ? `${step.bgClass} ${step.borderClass}` : 'border-muted-foreground/30 bg-muted'
                  )}>
                    {isComplete ? (
                      <CheckCircle className={cn('h-4 w-4', step.colorClass)} />
                    ) : (
                      <span className="text-xs font-bold text-muted-foreground">{idx + 1}</span>
                    )}
                  </div>
                  {idx < STEPS.length - 1 && (
                    <div className={cn(
                      'w-0.5 h-8',
                      isComplete ? 'bg-primary/40' : 'bg-muted-foreground/20'
                    )} />
                  )}
                </div>

                {/* Content */}
                <div className="flex-1 pb-3">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={cn('text-sm font-medium', step.colorClass)}>{step.label}</span>
                    {count > 0 && (
                      <Badge variant="secondary" className="text-[10px] h-5 px-1.5">
                        {count} {count === 1 ? 'photo' : 'photos'}
                      </Badge>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    disabled={isUploading}
                    onClick={() => fileInputRefs.current[step.key]?.click()}
                  >
                    {isActive ? (
                      <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Uploading...</>
                    ) : (
                      <><Upload className="h-3 w-3 mr-1" />Upload {step.label}</>
                    )}
                  </Button>
                  <input
                    ref={el => { fileInputRefs.current[step.key] = el; }}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={e => handleFileSelect(e, step.key)}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
