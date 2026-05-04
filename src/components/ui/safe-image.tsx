import React from 'react';
import { useHeicUrl } from '@/hooks/useHeicConverter';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SafeImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
}

/**
 * Drop-in <img> replacement that auto-converts HEIC/HEIF URLs
 * to displayable JPEG blob URLs using heic2any.
 */
export function SafeImage({ src, className, alt, loading = 'lazy', decoding = 'async', ...props }: SafeImageProps) {
  const { displayUrl, loading } = useHeicUrl(src);

  if (loading) {
    return (
      <div className={cn('flex items-center justify-center bg-muted', className)}>
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return <img src={displayUrl} alt={alt} className={className} loading={loading} decoding={decoding} {...props} />;
}
