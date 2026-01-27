import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X, Camera, Trash2, RotateCcw, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { isMobileDevice, hasHomeIndicator } from '@/utils/mobileDetection';
import jsPDF from 'jspdf';

interface CapturedPage {
  blob: Blob;
  preview: string;
}

interface DocumentScannerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentType: string;
  documentLabel: string;
  pipelineEntryId: string;
  onUploadComplete?: () => void;
}

export function DocumentScannerDialog({
  open,
  onOpenChange,
  documentType,
  documentLabel,
  pipelineEntryId,
  onUploadComplete,
}: DocumentScannerDialogProps) {
  const [capturedPages, setCapturedPages] = useState<CapturedPage[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Start camera when dialog opens
  useEffect(() => {
    if (open) {
      startCamera();
    } else {
      stopCamera();
      // Clean up captured pages on close
      capturedPages.forEach(page => URL.revokeObjectURL(page.preview));
      setCapturedPages([]);
      setCameraError(null);
    }
    
    return () => {
      stopCamera();
    };
  }, [open]);

  const startCamera = async () => {
    setCameraReady(false);
    setCameraError(null);
    
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment', // Back camera for documents
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      
      streamRef.current = mediaStream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        videoRef.current.onloadedmetadata = () => {
          setCameraReady(true);
        };
      }
    } catch (error: any) {
      console.error('Failed to start camera:', error);
      setCameraError(
        error.name === 'NotAllowedError'
          ? 'Camera access denied. Please allow camera permissions.'
          : 'Could not access camera. Please check permissions.'
      );
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setCameraReady(false);
  };

  const capturePhoto = useCallback(() => {
    if (!videoRef.current || !canvasRef.current || !cameraReady) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');

    if (!ctx) return;

    // Set canvas size to video dimensions
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    // Draw video frame to canvas
    ctx.drawImage(video, 0, 0);

    // Add page number overlay
    const pageNum = capturedPages.length + 1;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    ctx.fillRect(canvas.width - 80, 10, 70, 30);
    ctx.fillStyle = 'white';
    ctx.font = 'bold 16px sans-serif';
    ctx.fillText(`Page ${pageNum}`, canvas.width - 75, 30);

    // Convert to blob
    canvas.toBlob(
      (blob) => {
        if (blob) {
          const preview = URL.createObjectURL(blob);
          setCapturedPages(prev => [...prev, { blob, preview }]);
        }
      },
      'image/jpeg',
      0.9
    );
  }, [cameraReady, capturedPages.length]);

  const removePage = (index: number) => {
    setCapturedPages(prev => {
      const newPages = [...prev];
      URL.revokeObjectURL(newPages[index].preview);
      newPages.splice(index, 1);
      return newPages;
    });
  };

  // Helper: Convert Blob to Data URL
  const blobToDataURL = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  // Helper: Load image to get dimensions
  const loadImage = (src: string): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  };

  // Generate combined PDF from captured pages
  const generateCombinedPDF = async (pages: CapturedPage[]): Promise<Blob> => {
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'letter', // 8.5" x 11" standard
    });

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const margin = 10; // 10mm margins

    for (let i = 0; i < pages.length; i++) {
      // Add new page for subsequent pages
      if (i > 0) {
        pdf.addPage();
      }

      // Convert blob to data URL for jsPDF
      const dataUrl = await blobToDataURL(pages[i].blob);
      
      // Create image element to get dimensions
      const img = await loadImage(dataUrl);
      
      // Calculate dimensions to fit page with margins
      const imgAspect = img.width / img.height;
      const pageAspect = (pageWidth - 2 * margin) / (pageHeight - 2 * margin);
      
      let imgWidth: number;
      let imgHeight: number;
      
      if (imgAspect > pageAspect) {
        // Image is wider than page - fit to width
        imgWidth = pageWidth - 2 * margin;
        imgHeight = imgWidth / imgAspect;
      } else {
        // Image is taller than page - fit to height
        imgHeight = pageHeight - 2 * margin;
        imgWidth = imgHeight * imgAspect;
      }

      // Center on page
      const xOffset = (pageWidth - imgWidth) / 2;
      const yOffset = (pageHeight - imgHeight) / 2;

      pdf.addImage(dataUrl, 'JPEG', xOffset, yOffset, imgWidth, imgHeight);
    }

    return pdf.output('blob');
  };

  const handleBatchUpload = async () => {
    if (capturedPages.length === 0) {
      toast({
        title: 'No Pages',
        description: 'Please capture at least one page before uploading.',
        variant: 'destructive',
      });
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);

    try {
      // Get user and tenant info
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id')
        .eq('id', user.id)
        .single();

      if (!profile?.tenant_id) throw new Error('Tenant not found');

      setUploadProgress(10);

      // Generate combined PDF from captured pages
      const pdfBlob = await generateCombinedPDF(capturedPages);
      
      setUploadProgress(50);

      // Upload single PDF file
      const timestamp = Date.now();
      const sanitizedLabel = documentLabel.replace(/\s+/g, '_');
      const fileName = `${pipelineEntryId}/${timestamp}_${documentType}.pdf`;

      const { error: uploadError } = await supabase.storage
        .from('documents')
        .upload(fileName, pdfBlob, {
          contentType: 'application/pdf',
        });

      if (uploadError) throw uploadError;

      setUploadProgress(80);

      // Create document record with PDF info
      const { error: dbError } = await supabase
        .from('documents')
        .insert({
          tenant_id: profile.tenant_id,
          pipeline_entry_id: pipelineEntryId,
          document_type: documentType,
          filename: `${sanitizedLabel}.pdf`,
          file_path: fileName,
          file_size: pdfBlob.size,
          mime_type: 'application/pdf',
          uploaded_by: user.id,
          metadata: {
            page_count: capturedPages.length,
            scan_timestamp: timestamp,
            generated_from: 'document_scanner',
          },
        });

      if (dbError) throw dbError;

      setUploadProgress(100);

      toast({
        title: 'PDF Created',
        description: `${capturedPages.length}-page PDF uploaded successfully.`,
      });

      // Cleanup and close
      capturedPages.forEach(page => URL.revokeObjectURL(page.preview));
      setCapturedPages([]);
      onOpenChange(false);
      onUploadComplete?.();
    } catch (error: any) {
      console.error('PDF generation error:', error);
      toast({
        title: 'Upload Failed',
        description: error.message || 'Failed to create PDF. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  const handleClose = () => {
    if (capturedPages.length > 0 && !isUploading) {
      // Confirm before discarding
      if (!confirm(`Discard ${capturedPages.length} captured page${capturedPages.length > 1 ? 's' : ''}?`)) {
        return;
      }
    }
    onOpenChange(false);
  };

  const isMobile = isMobileDevice();
  const bottomPadding = hasHomeIndicator() ? 'pb-8' : 'pb-4';

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent 
        className={cn(
          "max-w-full h-[100dvh] sm:max-w-2xl sm:h-auto sm:max-h-[90vh] p-0 gap-0",
          "flex flex-col bg-background"
        )}
      >
        {/* Header */}
        <DialogHeader className="px-4 py-3 border-b flex-shrink-0">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-lg font-semibold flex items-center gap-2">
              📄 Scan {documentLabel}
              {capturedPages.length > 0 && (
                <span className="text-sm font-normal text-muted-foreground">
                  • {capturedPages.length} page{capturedPages.length > 1 ? 's' : ''}
                </span>
              )}
            </DialogTitle>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleClose}
              disabled={isUploading}
              className="h-8 w-8"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>

        {/* Camera Preview */}
        <div className="flex-1 relative bg-black min-h-0 overflow-hidden">
          {cameraError ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-white p-4 text-center">
              <Camera className="h-12 w-12 mb-4 opacity-50" />
              <p className="text-lg mb-2">Camera Error</p>
              <p className="text-sm opacity-75 mb-4">{cameraError}</p>
              <Button variant="outline" onClick={startCamera}>
                <RotateCcw className="h-4 w-4 mr-2" />
                Try Again
              </Button>
            </div>
          ) : (
            <>
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
              />
              {!cameraReady && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                  <Loader2 className="h-8 w-8 animate-spin text-white" />
                </div>
              )}
              {/* Document frame guide */}
              {cameraReady && (
                <div className="absolute inset-4 border-2 border-white/30 rounded-lg pointer-events-none">
                  <div className="absolute top-2 left-2 w-6 h-6 border-t-2 border-l-2 border-white rounded-tl" />
                  <div className="absolute top-2 right-2 w-6 h-6 border-t-2 border-r-2 border-white rounded-tr" />
                  <div className="absolute bottom-2 left-2 w-6 h-6 border-b-2 border-l-2 border-white rounded-bl" />
                  <div className="absolute bottom-2 right-2 w-6 h-6 border-b-2 border-r-2 border-white rounded-br" />
                </div>
              )}
            </>
          )}
          <canvas ref={canvasRef} className="hidden" />
        </div>

        {/* Thumbnail Strip */}
        {capturedPages.length > 0 && (
          <div className="flex-shrink-0 border-t bg-muted/50 p-2 overflow-x-auto">
            <div className="flex gap-2 min-w-min">
              {capturedPages.map((page, index) => (
                <div
                  key={index}
                  className="relative group flex-shrink-0 w-16 h-20 rounded-md overflow-hidden border-2 border-border"
                >
                  <img
                    src={page.preview}
                    alt={`Page ${index + 1}`}
                    className="w-full h-full object-cover"
                  />
                  <div className="absolute top-0 left-0 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded-br">
                    {index + 1}
                  </div>
                  <button
                    onClick={() => removePage(index)}
                    disabled={isUploading}
                    className="absolute top-0 right-0 p-1 bg-destructive text-destructive-foreground rounded-bl opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Upload Progress */}
        {isUploading && (
          <div className="flex-shrink-0 px-4 py-2 border-t bg-muted/30">
            <div className="flex items-center gap-3">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <div className="flex-1">
                <Progress value={uploadProgress} className="h-2" />
              </div>
              <span className="text-sm text-muted-foreground">{Math.round(uploadProgress)}%</span>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className={cn(
          "flex-shrink-0 flex items-center justify-between gap-3 px-4 py-3 border-t bg-background",
          bottomPadding
        )}>
          <Button
            variant="outline"
            onClick={handleClose}
            disabled={isUploading}
            className="flex-1 sm:flex-none"
          >
            Cancel
          </Button>
          
          {/* Capture Button */}
          <button
            onClick={capturePhoto}
            disabled={!cameraReady || isUploading}
            className={cn(
              "w-16 h-16 sm:w-14 sm:h-14 rounded-full",
              "bg-primary hover:bg-primary/90 active:scale-95",
              "flex items-center justify-center",
              "transition-all duration-150",
              "disabled:opacity-50 disabled:cursor-not-allowed",
              "border-4 border-primary-foreground shadow-lg"
            )}
            aria-label="Capture page"
          >
            <Camera className="h-6 w-6 text-primary-foreground" />
          </button>

          <Button
            onClick={handleBatchUpload}
            disabled={capturedPages.length === 0 || isUploading}
            className="flex-1 sm:flex-none gradient-primary"
          >
            {isUploading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Uploading...
              </>
            ) : (
              `Upload (${capturedPages.length})`
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
