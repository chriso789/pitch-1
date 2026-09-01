import React from 'react';
import { useHeicUrl } from '@/hooks/useHeicConverter';
import { Loader2, ImageOff } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SafeImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
}

/**
 * Drop-in <img> replacement that auto-converts HEIC/HEIF URLs
 * to displayable JPEG blob URLs using heic2any.
 */
export function SafeImage({ src, className, alt, loading: imageLoading = 'lazy', decoding = 'async', ...props }: SafeImageProps) {
  const { displayUrl, loading, error } = useHeicUrl(src);

  if (loading) {
    return (
      <div className={cn('flex items-center justify-center bg-muted', className)}>
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn('flex flex-col items-center justify-center gap-1 bg-muted p-2 text-center', className)}>
        <ImageOff className="h-4 w-4 text-muted-foreground" />
        <span className="text-[10px] leading-tight text-muted-foreground">Preview unavailable</span>
      </div>
    );
  }

  return <img src={displayUrl} alt={alt} className={className} loading={imageLoading} decoding={decoding} {...props} />;
}
