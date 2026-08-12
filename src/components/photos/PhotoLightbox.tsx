import React, { useCallback, useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ChevronLeft, ChevronRight, Download, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/use-toast';
import { downloadPhotoAsJpeg } from '@/lib/photos/downloadPhotoJpeg';
import { SafeImage } from '@/components/ui/safe-image';

import type { CustomerPhoto } from '@/hooks/usePhotos';

interface PhotoLightboxProps {
  photos: CustomerPhoto[];
  index: number | null;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}

export const PhotoLightbox: React.FC<PhotoLightboxProps> = ({
  photos,
  index,
  onIndexChange,
  onClose,
}) => {
  const [downloading, setDownloading] = useState(false);
  const open = index !== null && index >= 0 && index < photos.length;
  const photo = open ? photos[index as number] : null;

  const go = useCallback(
    (delta: number) => {
      if (index === null || photos.length === 0) return;
      const next = (index + delta + photos.length) % photos.length;
      onIndexChange(next);
    },
    [index, photos.length, onIndexChange]
  );

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, go]);

  const handleDownload = async () => {
    if (!photo) return;
    setDownloading(true);
    try {
      await downloadPhotoAsJpeg(photo, index ?? 0);
    } catch (err) {
      console.error('[PhotoLightbox] download failed', err);
      toast({
        title: 'Download failed',
        description: err instanceof Error ? err.message : 'Unable to download photo',
        variant: 'destructive',
      });
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-6xl w-[96vw] h-[92vh] p-0 bg-background flex flex-col overflow-hidden">
        <DialogTitle className="sr-only">Photo preview</DialogTitle>

        <div className="flex items-center gap-2 px-4 py-2 border-b pr-12">
          <span className="text-sm font-medium truncate">
            {photo?.description || photo?.original_filename || 'Photo'}
          </span>
          {photo?.category && (
            <Badge variant="outline" className="text-[10px]">
              {photo.category}
            </Badge>
          )}
          <div className="flex-1" />
          <span className="text-xs text-muted-foreground">
            {open ? `${(index as number) + 1} / ${photos.length}` : ''}
          </span>
          <Button size="sm" variant="outline" onClick={handleDownload} disabled={downloading}>
            {downloading ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5 mr-1.5" />
            )}
            JPEG
          </Button>
        </div>

        <div className="relative flex-1 min-h-0 bg-muted/40 flex items-center justify-center">
          {photo && (
            <SafeImage
              key={photo.id}
              src={photo.file_url}
              alt={photo.description || 'Photo preview'}
              className="max-h-full max-w-full object-contain"
              loading="eager"
            />
          )}


          {photos.length > 1 && (
            <>
              <Button
                variant="secondary"
                size="icon"
                aria-label="Previous photo"
                className={cn('absolute left-3 top-1/2 -translate-y-1/2 rounded-full shadow-md')}
                onClick={() => go(-1)}
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
              <Button
                variant="secondary"
                size="icon"
                aria-label="Next photo"
                className={cn('absolute right-3 top-1/2 -translate-y-1/2 rounded-full shadow-md')}
                onClick={() => go(1)}
              >
                <ChevronRight className="h-5 w-5" />
              </Button>
            </>
          )}
        </div>

        {photos.length > 1 && (
          <div className="flex gap-2 overflow-x-auto px-3 py-2 border-t">
            {photos.map((p, i) => (
              <button
                key={p.id}
                onClick={() => onIndexChange(i)}
                className={cn(
                  'h-14 w-14 flex-shrink-0 rounded overflow-hidden border transition-all',
                  i === index ? 'ring-2 ring-primary' : 'opacity-70 hover:opacity-100'
                )}
                aria-label={`View photo ${i + 1}`}
              >
                <img src={p.file_url} alt="" className="h-full w-full object-cover" loading="lazy" />
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
