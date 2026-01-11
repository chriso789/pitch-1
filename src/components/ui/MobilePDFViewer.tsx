import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { 
  Download, 
  ExternalLink, 
  ZoomIn, 
  ZoomOut, 
  Maximize2,
  Loader2,
  FileText 
} from 'lucide-react';
import { isIOS, isMobileDevice, supportsInlinePDF } from '@/utils/mobileDetection';
import { cn } from '@/lib/utils';

interface MobilePDFViewerProps {
  url: string;
  title?: string;
  filename?: string;
  onDownload?: () => void;
  className?: string;
  showControls?: boolean;
}

export const MobilePDFViewer: React.FC<MobilePDFViewerProps> = ({
  url,
  title = 'Document',
  filename = 'document.pdf',
  onDownload,
  className,
  showControls = true,
}) => {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [zoom, setZoom] = useState(100);

  const isMobile = isMobileDevice();
  const canShowInline = supportsInlinePDF();
  const isIOSDevice = isIOS();

  useEffect(() => {
    // Reset states when URL changes
    setIsLoading(true);
    setHasError(false);
    setZoom(100);
  }, [url]);

  const handleOpenExternal = () => {
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const handleFullscreen = () => {
    setIsFullscreen(true);
    // Open in new tab for true fullscreen on mobile
    if (isMobile) {
      handleOpenExternal();
    }
  };

  const handleZoomIn = () => {
    setZoom(prev => Math.min(prev + 25, 200));
  };

  const handleZoomOut = () => {
    setZoom(prev => Math.max(prev - 25, 50));
  };

  const handleDownload = () => {
    if (onDownload) {
      onDownload();
    } else {
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
    }
  };

  // For iOS or devices that don't support inline PDFs well
  if (!canShowInline || hasError) {
    return (
      <Card className={cn('flex flex-col items-center justify-center p-8 gap-4', className)}>
        <FileText className="h-16 w-16 text-muted-foreground" />
        <div className="text-center">
          <h3 className="font-semibold text-lg mb-2">{title}</h3>
          <p className="text-muted-foreground text-sm mb-4">
            {isIOSDevice 
              ? 'Tap below to view the PDF in Safari for the best experience'
              : 'Tap below to view or download the document'}
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
          <Button 
            onClick={handleOpenExternal} 
            className="min-h-[48px] px-6 touch-target"
            size="lg"
          >
            <ExternalLink className="h-5 w-5 mr-2" />
            Open PDF
          </Button>
          <Button 
            variant="outline" 
            onClick={handleDownload}
            className="min-h-[48px] px-6 touch-target"
            size="lg"
          >
            <Download className="h-5 w-5 mr-2" />
            Download
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className={cn('relative flex flex-col', className)}>
      {/* Mobile zoom controls */}
      {showControls && (
        <div className="flex items-center justify-between gap-2 p-2 bg-muted/50 border-b">
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleZoomOut}
              disabled={zoom <= 50}
              className="h-10 w-10 touch-target"
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
            <span className="text-sm font-medium w-14 text-center">{zoom}%</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleZoomIn}
              disabled={zoom >= 200}
              className="h-10 w-10 touch-target"
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
          </div>
          
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleFullscreen}
              className="h-10 w-10 touch-target"
            >
              <Maximize2 className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleOpenExternal}
              className="h-10 w-10 touch-target"
            >
              <ExternalLink className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDownload}
              className="h-10 w-10 touch-target"
            >
              <Download className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* PDF Container */}
      <div 
        className="relative flex-1 overflow-auto bg-muted/30"
        style={{ 
          minHeight: isMobile ? '50vh' : '400px',
          maxHeight: isMobile ? '70vh' : '80vh',
        }}
      >
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/80 z-10">
            <div className="flex flex-col items-center gap-2">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
              <p className="text-sm text-muted-foreground">Loading PDF...</p>
            </div>
          </div>
        )}
        
        <div 
          className="w-full h-full transition-transform"
          style={{ 
            transform: `scale(${zoom / 100})`,
            transformOrigin: 'top left',
            width: `${100 / (zoom / 100)}%`,
          }}
        >
          <object
            data={url}
            type="application/pdf"
            className="w-full h-full"
            style={{ 
              minHeight: isMobile ? '50vh' : '400px',
              height: isMobile ? '60vh' : '70vh',
            }}
            onLoad={() => setIsLoading(false)}
            onError={() => {
              setIsLoading(false);
              setHasError(true);
            }}
          >
            <embed 
              src={url} 
              type="application/pdf"
              className="w-full h-full"
              style={{ 
                minHeight: isMobile ? '50vh' : '400px',
                height: isMobile ? '60vh' : '70vh',
              }}
            />
          </object>
        </div>
      </div>
    </div>
  );
};

export default MobilePDFViewer;
