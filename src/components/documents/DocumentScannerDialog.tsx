import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X, Camera, Trash2, RotateCcw, Loader2, FileText, Image, Edit2, Zap, ZapOff } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { isMobileDevice, hasHomeIndicator } from '@/utils/mobileDetection';
import jsPDF from 'jspdf';
import { detectDocumentEdges, DetectedCorners } from '@/utils/documentEdgeDetection';
import { detectDocumentEdgesOpenCV, loadOpenCV, isOpenCVAvailable, DetectedCornersExt } from '@/utils/documentEdgeDetectionOpenCV';
import { CornerStabilityBuffer, validateQuadrilateral, StabilityResult } from '@/utils/documentStability';
import { enhanceDocumentPro } from '@/utils/documentEnhancementPro';
import { ManualCropOverlay } from './ManualCropOverlay';
import { analyzeFrameQuality, evaluateQualityGate, QualityFlags, QualityGateResult } from '@/utils/documentQuality';
import { classifyAspectRatio, dominantPageSize, getPageSpec, DetectedPageSize } from '@/utils/documentPageSize';
import { deskewCanvas } from '@/utils/documentDeskew';
import { getTorchCapability, setTorch } from '@/utils/cameraTorch';

interface CapturedPage {
  blob: Blob;
  preview: string;
  cropMode: 'auto' | 'manual';
  colorMode: 'color' | 'bw';
  confidence: number | null;
  pageSize: DetectedPageSize;
  deskewAngle: number;
  quality: QualityFlags | null;
}

const SCANNER_VERSION = '2.1.0';
const MAX_PDF_BYTES = 10 * 1024 * 1024; // 10MB


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
  const [detectedCorners, setDetectedCorners] = useState<DetectedCornersExt | null>(null);
  const [stabilityResult, setStabilityResult] = useState<StabilityResult | null>(null);
  const [processingMode, setProcessingMode] = useState<'color' | 'bw'>('bw');
  const [isProcessing, setIsProcessing] = useState(false);
  const [videoWidth, setVideoWidth] = useState(0);
  const [videoHeight, setVideoHeight] = useState(0);
  const [opencvLoading, setOpencvLoading] = useState(false);
  const [opencvReady, setOpencvReady] = useState(false);
  const [opencvFailed, setOpencvFailed] = useState(false);
  const [qualityGate, setQualityGate] = useState<QualityGateResult | null>(null);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  // Manual crop state
  const [showManualCrop, setShowManualCrop] = useState(false);
  const [manualCropImage, setManualCropImage] = useState<{ url: string; width: number; height: number } | null>(null);
  const [pendingCaptureCanvas, setPendingCaptureCanvas] = useState<HTMLCanvasElement | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectionIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const stabilityBufferRef = useRef(new CornerStabilityBuffer());

  // Preload OpenCV during browser idle so the first scan doesn't pay the
  // 8MB WASM hit. Triggered when the dialog mounts; safe to call repeatedly.
  useEffect(() => {
    if (isOpenCVAvailable()) {
      setOpencvReady(true);
      return;
    }
    const kick = () => {
      setOpencvLoading(true);
      loadOpenCV()
        .then((ok) => {
          setOpencvReady(!!ok);
          setOpencvFailed(!ok);
        })
        .finally(() => setOpencvLoading(false));
    };
    const ric = (window as any).requestIdleCallback as undefined | ((cb: () => void, opts?: any) => number);
    if (ric) {
      const id = ric(kick, { timeout: 1500 });
      return () => {
        const cic = (window as any).cancelIdleCallback as undefined | ((id: number) => void);
        cic?.(id);
      };
    }
    const t = setTimeout(kick, 200);
    return () => clearTimeout(t);
  }, []);


  // Start camera when dialog opens
  useEffect(() => {
    if (open) {
      startCamera();
      stabilityBufferRef.current.reset();
    } else {
      stopCamera();
      // Clean up captured pages on close
      capturedPages.forEach(page => URL.revokeObjectURL(page.preview));
      setCapturedPages([]);
      setCameraError(null);
      setDetectedCorners(null);
      setStabilityResult(null);
      setShowManualCrop(false);
      setManualCropImage(null);
      setPendingCaptureCanvas(null);
    }
    
    return () => {
      stopCamera();
    };
  }, [open]);

  // Edge detection loop with stability tracking
  useEffect(() => {
    if (!cameraReady || !videoRef.current) {
      if (detectionIntervalRef.current) {
        clearInterval(detectionIntervalRef.current);
        detectionIntervalRef.current = null;
      }
      return;
    }
    
    const runDetection = async () => {
      const video = videoRef.current;
      if (!video || video.videoWidth === 0) return;
      
      // Update video dimensions for overlay
      if (video.videoWidth !== videoWidth || video.videoHeight !== videoHeight) {
        setVideoWidth(video.videoWidth);
        setVideoHeight(video.videoHeight);
      }
      
      // Downsample for performance (2x preserves more edge detail)
      const tempCanvas = document.createElement('canvas');
      const scale = 2;
      tempCanvas.width = Math.floor(video.videoWidth / scale);
      tempCanvas.height = Math.floor(video.videoHeight / scale);
      const ctx = tempCanvas.getContext('2d');
      if (!ctx) return;
      
      ctx.drawImage(video, 0, 0, tempCanvas.width, tempCanvas.height);
      const imageData = ctx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
      
      // Try OpenCV detection first, fall back to basic detector
      let corners: DetectedCornersExt | null = null;

      if (isOpenCVAvailable()) {
        corners = (await detectDocumentEdgesOpenCV(imageData)) as DetectedCornersExt | null;
      }

      if (!corners) {
        const fb = detectDocumentEdges(imageData);
        if (fb) corners = { ...fb } as DetectedCornersExt;
      }

      // Quality gate runs on the downsampled frame regardless of detection.
      const flags = analyzeFrameQuality(imageData);
      const gate = evaluateQualityGate(flags);
      setQualityGate(gate);

      if (corners) {
        // Scale corners back to full resolution
        const scaledCorners: DetectedCornersExt = {
          topLeft: { x: corners.topLeft.x * scale, y: corners.topLeft.y * scale },
          topRight: { x: corners.topRight.x * scale, y: corners.topRight.y * scale },
          bottomRight: { x: corners.bottomRight.x * scale, y: corners.bottomRight.y * scale },
          bottomLeft: { x: corners.bottomLeft.x * scale, y: corners.bottomLeft.y * scale },
          confidence: corners.confidence,
          aspectRatio: corners.aspectRatio,
          pageSize: corners.pageSize,
        };

        const stability = stabilityBufferRef.current.addFrame(scaledCorners);
        setStabilityResult(stability);

        const display: DetectedCornersExt = stability.averagedCorners
          ? { ...stability.averagedCorners, aspectRatio: scaledCorners.aspectRatio, pageSize: scaledCorners.pageSize }
          : scaledCorners;
        setDetectedCorners(display);
      } else {
        stabilityBufferRef.current.addFrame(null);
        setDetectedCorners(null);
        setStabilityResult(null);
      }
    };

    
    // Run detection every 200ms
    detectionIntervalRef.current = setInterval(runDetection, 200);
    
    return () => {
      if (detectionIntervalRef.current) {
        clearInterval(detectionIntervalRef.current);
        detectionIntervalRef.current = null;
      }
    };
  }, [cameraReady, videoWidth, videoHeight]);

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
      // Probe torch capability (Chromium-only). Settles state for the UI.
      const cap = getTorchCapability(mediaStream);
      setTorchSupported(cap.supported);
      setTorchOn(false);

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
    if (detectionIntervalRef.current) {
      clearInterval(detectionIntervalRef.current);
      detectionIntervalRef.current = null;
    }
    if (streamRef.current) {
      // Best-effort torch-off before stopping tracks.
      setTorch(streamRef.current, false).catch(() => {});
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setCameraReady(false);
    setDetectedCorners(null);
    setStabilityResult(null);
    setTorchOn(false);
    setTorchSupported(false);
    setQualityGate(null);
  };

  // Process captured frame with given corners
  const processAndAddPage = useCallback(async (
    sourceCanvas: HTMLCanvasElement,
    corners: DetectedCornersExt,
    cropMode: 'auto' | 'manual',
    capturedQuality: QualityFlags | null,
  ) => {
    try {
      const validation = validateQuadrilateral(corners, sourceCanvas.width, sourceCanvas.height);
      if (!validation.valid) {
        toast({
          title: 'Invalid Selection',
          description: validation.reason || 'Please adjust the document corners.',
          variant: 'destructive',
        });
        return false;
      }

      // Page-size guess from the quad's aspect ratio, then map to spec.
      // We compute here too (not just in the OpenCV detector) so manual crops
      // and the JS fallback also produce a page-size guess.
      const w1 = Math.hypot(corners.topRight.x - corners.topLeft.x, corners.topRight.y - corners.topLeft.y);
      const w2 = Math.hypot(corners.bottomRight.x - corners.bottomLeft.x, corners.bottomRight.y - corners.bottomLeft.y);
      const h1 = Math.hypot(corners.bottomLeft.x - corners.topLeft.x, corners.bottomLeft.y - corners.topLeft.y);
      const h2 = Math.hypot(corners.bottomRight.x - corners.topRight.x, corners.bottomRight.y - corners.topRight.y);
      const longSide = Math.max((w1 + w2) / 2, (h1 + h2) / 2);
      const shortSide = Math.max(1, Math.min((w1 + w2) / 2, (h1 + h2) / 2));
      const pageSize: DetectedPageSize = corners.pageSize ?? classifyAspectRatio(longSide, shortSide);
      const spec = getPageSpec(pageSize);

      // Enhance at the page-spec dimensions (not always letter).
      let enhanced = enhanceDocumentPro(sourceCanvas, corners, {
        mode: processingMode,
        illuminationCorrection: true,
        whiteBackground: true,
        sharpen: processingMode === 'color',
        outputWidth: spec.outputWidth,
        outputHeight: spec.outputHeight,
      });

      // Post-warp deskew (±5°). Operates on the rectified canvas.
      const { canvas: deskewed, angle: deskewAngle } = deskewCanvas(enhanced);
      enhanced = deskewed;

      // Page-number badge
      const pageNum = capturedPages.length + 1;
      const enhancedCtx = enhanced.getContext('2d');
      if (enhancedCtx) {
        enhancedCtx.fillStyle = 'rgba(0, 0, 0, 0.6)';
        enhancedCtx.fillRect(enhanced.width - 120, 15, 100, 40);
        enhancedCtx.fillStyle = 'white';
        enhancedCtx.font = 'bold 24px sans-serif';
        enhancedCtx.fillText(`Page ${pageNum}`, enhanced.width - 110, 45);
      }

      const colorMode = processingMode;
      const confidence = corners.confidence ?? null;

      return new Promise<boolean>((resolve) => {
        enhanced.toBlob(
          (blob) => {
            if (blob) {
              const preview = URL.createObjectURL(blob);
              setCapturedPages(prev => [...prev, {
                blob, preview, cropMode, colorMode, confidence,
                pageSize, deskewAngle, quality: capturedQuality,
              }]);
              resolve(true);
            } else {
              resolve(false);
            }
          },
          'image/jpeg',
          0.95
        );
      });
    } catch (error) {
      console.error('Processing error:', error);
      return false;
    }
  }, [capturedPages.length, processingMode]);

  const captureAndProcess = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current || !cameraReady) return;

    setIsProcessing(true);

    try {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');

      if (!ctx) return;

      // Set canvas size to video dimensions
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      // Draw video frame to canvas
      ctx.drawImage(video, 0, 0);

      // Check if we have stable detection
      const currentStability = stabilityBufferRef.current.getResult();
      
      if (currentStability.stable && currentStability.averagedCorners) {
        // AUTO MODE: Use stable corners immediately
        const success = await processAndAddPage(canvas, currentStability.averagedCorners, 'auto');
        if (!success) {
          toast({
            title: 'Processing Failed',
            description: 'Failed to process the captured image. Please try again.',
            variant: 'destructive',
          });
        }
      } else {
        // MANUAL MODE: Show crop overlay
        // Create a copy of the canvas for manual cropping
        const captureCanvas = document.createElement('canvas');
        captureCanvas.width = canvas.width;
        captureCanvas.height = canvas.height;
        const captureCtx = captureCanvas.getContext('2d');
        captureCtx?.drawImage(canvas, 0, 0);
        
        setPendingCaptureCanvas(captureCanvas);
        
        // Create image URL for overlay
        canvas.toBlob((blob) => {
          if (blob) {
            const url = URL.createObjectURL(blob);
            setManualCropImage({
              url,
              width: canvas.width,
              height: canvas.height,
            });
            setShowManualCrop(true);
          }
        }, 'image/jpeg', 0.9);
      }
    } catch (error) {
      console.error('Capture error:', error);
      toast({
        title: 'Capture Failed',
        description: 'Failed to capture the image. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsProcessing(false);
    }
  }, [cameraReady, processAndAddPage]);

  // Handle manual crop confirmation
  const handleManualCropConfirm = useCallback(async (corners: DetectedCorners) => {
    if (!pendingCaptureCanvas) return;
    
    setIsProcessing(true);
    setShowManualCrop(false);
    
    try {
      const success = await processAndAddPage(pendingCaptureCanvas, corners, 'manual');
      if (!success) {
        toast({
          title: 'Processing Failed',
          description: 'Failed to process the cropped image. Please try again.',
          variant: 'destructive',
        });
      }
    } finally {
      setIsProcessing(false);
      if (manualCropImage) {
        URL.revokeObjectURL(manualCropImage.url);
      }
      setManualCropImage(null);
      setPendingCaptureCanvas(null);
    }
  }, [pendingCaptureCanvas, processAndAddPage, manualCropImage]);

  // Handle manual crop cancel
  const handleManualCropCancel = useCallback(() => {
    setShowManualCrop(false);
    if (manualCropImage) {
      URL.revokeObjectURL(manualCropImage.url);
    }
    setManualCropImage(null);
    setPendingCaptureCanvas(null);
  }, [manualCropImage]);

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

  // Re-encode a JPEG blob at a lower quality / optional downscale to shrink PDF size
  const reencodePageBlob = async (
    blob: Blob,
    quality: number,
    maxWidth?: number
  ): Promise<Blob> => {
    const bitmap = await createImageBitmap(blob);
    let { width, height } = bitmap;
    if (maxWidth && width > maxWidth) {
      const ratio = maxWidth / width;
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);
    }
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bitmap.close();
      return blob;
    }
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    return await new Promise<Blob>((resolve) =>
      canvas.toBlob(
        (b) => resolve(b ?? blob),
        'image/jpeg',
        quality
      )
    );
  };

  // Build PDF from pages at the given JPEG quality / DPI cap
  const buildPdfAtQuality = async (
    pages: CapturedPage[],
    quality: number,
    maxImageWidth: number
  ): Promise<Blob> => {
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'in',
      format: 'letter',
      compress: true,
    });

    for (let i = 0; i < pages.length; i++) {
      if (i > 0) pdf.addPage();
      // Pick BW-vs-color baseline quality
      const baseQuality = pages[i].colorMode === 'bw'
        ? Math.min(quality, 0.82)
        : quality;
      const reencoded = await reencodePageBlob(pages[i].blob, baseQuality, maxImageWidth);
      const dataUrl = await blobToDataURL(reencoded);
      // 'SLOW' = better JPEG compression / quality tradeoff than 'FAST'
      pdf.addImage(dataUrl, 'JPEG', 0, 0, 8.5, 11, undefined, 'SLOW');
    }

    return pdf.output('blob');
  };

  // Compose PDF and recompress if it exceeds MAX_PDF_BYTES
  const generateCombinedPDFWithCap = async (
    pages: CapturedPage[]
  ): Promise<{ blob: Blob; dpi: number; quality: number; compressed: boolean }> => {
    // dpi here is the effective max width in px (8.5" * dpi)
    const ladder: Array<{ quality: number; dpi: number }> = [
      { quality: 0.85, dpi: 300 }, // ~2550 px
      { quality: 0.75, dpi: 300 },
      { quality: 0.75, dpi: 220 }, // ~1870 px
      { quality: 0.65, dpi: 220 },
      { quality: 0.65, dpi: 200 }, // ~1700 px
    ];

    let last: Blob | null = null;
    let lastStep = ladder[0];
    for (let i = 0; i < ladder.length; i++) {
      const step = ladder[i];
      const maxWidth = Math.round(8.5 * step.dpi);
      const blob = await buildPdfAtQuality(pages, step.quality, maxWidth);
      last = blob;
      lastStep = step;
      if (blob.size <= MAX_PDF_BYTES) {
        return {
          blob,
          dpi: step.dpi,
          quality: step.quality,
          compressed: i > 0,
        };
      }
    }
    return {
      blob: last as Blob,
      dpi: lastStep.dpi,
      quality: lastStep.quality,
      compressed: true,
    };
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

      // Generate combined PDF, recompressing if needed
      const { blob: pdfBlob, dpi, quality, compressed } =
        await generateCombinedPDFWithCap(capturedPages);

      if (pdfBlob.size > MAX_PDF_BYTES) {
        throw new Error(
          `PDF is ${(pdfBlob.size / 1024 / 1024).toFixed(1)}MB after compression and exceeds the 10MB limit. ` +
          `Try scanning fewer pages or using black & white mode.`
        );
      }

      if (compressed) {
        toast({
          title: 'PDF Compressed',
          description: `Reduced quality to keep the file under 10MB (${(pdfBlob.size / 1024 / 1024).toFixed(1)}MB).`,
        });
      }

      setUploadProgress(50);

      // Tenant-first storage path (required by storage RLS)
      const timestamp = Date.now();
      const sanitizedLabel = documentLabel.replace(/\s+/g, '_');
      const fileName = `${profile.tenant_id}/${pipelineEntryId}/${timestamp}_${documentType}.pdf`;

      const { error: uploadError } = await supabase.storage
        .from('documents')
        .upload(fileName, pdfBlob, {
          contentType: 'application/pdf',
        });

      if (uploadError) throw uploadError;

      setUploadProgress(80);

      // Aggregate per-page scan quality
      const confidences = capturedPages
        .map((p) => p.confidence)
        .filter((c): c is number => typeof c === 'number');
      const avgConfidence = confidences.length
        ? confidences.reduce((a, b) => a + b, 0) / confidences.length
        : null;
      const manualCropPages = capturedPages.filter((p) => p.cropMode === 'manual').length;
      const autoDetectedPages = capturedPages.filter((p) => p.cropMode === 'auto').length;
      const colorPages = capturedPages.filter((p) => p.colorMode === 'color').length;
      const bwPages = capturedPages.filter((p) => p.colorMode === 'bw').length;

      const capturedAt = new Date(timestamp).toISOString();

      const scanMetadata = {
        scanned: true,
        document_type: documentType,
        document_label: documentLabel,
        processing_mode: processingMode,
        page_count: capturedPages.length,
        dpi,
        jpeg_quality: quality,
        output_format: 'pdf',
        scanner_version: SCANNER_VERSION,
        captured_at: capturedAt,
        storage_path: fileName,
        compressed,
      };

      const scanQuality = {
        average_detection_confidence: avgConfidence,
        manual_crop_pages: manualCropPages,
        auto_detected_pages: autoDetectedPages,
        color_mode_pages: colorPages,
        bw_mode_pages: bwPages,
      };

      // Create document record with structured scan metadata
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
          // Short human-readable description only
          description: `Scanned ${capturedPages.length}-page ${documentLabel}`,
          page_count: capturedPages.length,
          scan_source: 'camera',
          metadata: scanMetadata,
          scan_quality: scanQuality,
          ocr_status: 'not_started',
        } as any);

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

  // Force manual crop mode
  const handleForceManualCrop = useCallback(() => {
    if (!videoRef.current || !canvasRef.current || !cameraReady) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Capture frame
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);

    // Create a copy for manual cropping
    const captureCanvas = document.createElement('canvas');
    captureCanvas.width = canvas.width;
    captureCanvas.height = canvas.height;
    const captureCtx = captureCanvas.getContext('2d');
    captureCtx?.drawImage(canvas, 0, 0);
    setPendingCaptureCanvas(captureCanvas);

    // Create image URL for overlay
    canvas.toBlob((blob) => {
      if (blob) {
        const url = URL.createObjectURL(blob);
        setManualCropImage({
          url,
          width: canvas.width,
          height: canvas.height,
        });
        setShowManualCrop(true);
      }
    }, 'image/jpeg', 0.9);
  }, [cameraReady]);

  const isMobile = isMobileDevice();
  const bottomPadding = hasHomeIndicator() ? 'pb-8' : 'pb-4';
  const isStable = stabilityResult?.stable ?? false;
  const detectionConfidence = detectedCorners?.confidence ?? 0;

  // Show manual crop overlay
  if (showManualCrop && manualCropImage) {
    return (
      <ManualCropOverlay
        imageUrl={manualCropImage.url}
        initialCorners={detectedCorners}
        imageWidth={manualCropImage.width}
        imageHeight={manualCropImage.height}
        onConfirm={handleManualCropConfirm}
        onCancel={handleManualCropCancel}
      />
    );
  }

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
              
              {/* Edge detection overlay */}
              {cameraReady && detectedCorners && videoWidth > 0 && (
                <svg 
                  className="absolute inset-0 pointer-events-none w-full h-full"
                  viewBox={`0 0 ${videoWidth} ${videoHeight}`}
                  preserveAspectRatio="xMidYMid slice"
                >
                  <polygon
                    points={`
                      ${detectedCorners.topLeft.x},${detectedCorners.topLeft.y}
                      ${detectedCorners.topRight.x},${detectedCorners.topRight.y}
                      ${detectedCorners.bottomRight.x},${detectedCorners.bottomRight.y}
                      ${detectedCorners.bottomLeft.x},${detectedCorners.bottomLeft.y}
                    `}
                    fill={isStable ? "hsla(142, 76%, 36%, 0.2)" : "hsla(45, 93%, 47%, 0.15)"}
                    stroke={isStable ? "hsl(142, 76%, 36%)" : "hsl(45, 93%, 47%)"}
                    strokeWidth="4"
                    className="transition-all duration-300"
                  />
                  {/* Corner markers */}
                  {[detectedCorners.topLeft, detectedCorners.topRight, detectedCorners.bottomRight, detectedCorners.bottomLeft].map((corner, i) => (
                    <circle 
                      key={i}
                      cx={corner.x} 
                      cy={corner.y} 
                      r="12" 
                      fill={isStable ? "hsl(142, 76%, 36%)" : "hsl(45, 93%, 47%)"} 
                      stroke="hsl(0, 0%, 100%)" 
                      strokeWidth="2"
                      className="transition-all duration-300"
                    />
                  ))}
                </svg>
              )}
              
              {/* Fallback frame guide when no detection */}
              {cameraReady && !detectedCorners && (
                <div className="absolute inset-4 border-2 border-white/30 rounded-lg pointer-events-none">
                  <div className="absolute top-2 left-2 w-6 h-6 border-t-2 border-l-2 border-white rounded-tl" />
                  <div className="absolute top-2 right-2 w-6 h-6 border-t-2 border-r-2 border-white rounded-tr" />
                  <div className="absolute bottom-2 left-2 w-6 h-6 border-b-2 border-l-2 border-white rounded-bl" />
                  <div className="absolute bottom-2 right-2 w-6 h-6 border-b-2 border-r-2 border-white rounded-br" />
                </div>
              )}
              
              {/* Detection status indicator */}
              {cameraReady && (
                <div className={cn(
                  "absolute top-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full text-sm font-medium shadow-lg transition-all duration-300",
                  isStable
                    ? "bg-success text-success-foreground"
                    : detectedCorners
                      ? "bg-warning text-warning-foreground"
                      : "bg-muted text-muted-foreground"
                )}>
                  {isStable 
                    ? '✓ Ready to Capture' 
                    : detectedCorners
                      ? 'Hold steady...'
                      : 'Position document in frame'}
                </div>
              )}
              
              {/* OpenCV loading indicator */}
              {opencvLoading && (
                <div className="absolute top-14 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-xs bg-primary/80 text-primary-foreground">
                  Loading scanner...
                </div>
              )}
              
              {/* Processing overlay */}
              {isProcessing && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                  <div className="flex flex-col items-center gap-2 text-white">
                    <Loader2 className="h-8 w-8 animate-spin" />
                    <span className="text-sm">Processing...</span>
                  </div>
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

        {/* Mode Toggle */}
        <div className="flex-shrink-0 flex gap-2 px-4 py-2 border-t bg-muted/30">
          <Button
            variant={processingMode === 'bw' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setProcessingMode('bw')}
            disabled={isUploading || isProcessing}
            className="flex-1"
          >
            <FileText className="h-4 w-4 mr-2" />
            Document
          </Button>
          <Button
            variant={processingMode === 'color' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setProcessingMode('color')}
            disabled={isUploading || isProcessing}
            className="flex-1"
          >
            <Image className="h-4 w-4 mr-2" />
            Color
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleForceManualCrop}
            disabled={!cameraReady || isUploading || isProcessing}
            title="Manually adjust corners"
          >
            <Edit2 className="h-4 w-4" />
          </Button>
        </div>

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
            disabled={isUploading || isProcessing}
            className="flex-1 sm:flex-none"
          >
            Cancel
          </Button>
          
          {/* Capture Button */}
          <button
            onClick={captureAndProcess}
            disabled={!cameraReady || isUploading || isProcessing}
            className={cn(
              "w-16 h-16 sm:w-14 sm:h-14 rounded-full",
              "bg-primary hover:bg-primary/90 active:scale-95",
              "flex items-center justify-center",
              "transition-all duration-150",
              "disabled:opacity-50 disabled:cursor-not-allowed",
              "border-4 border-primary-foreground shadow-lg",
              isStable && "ring-4 ring-success/50 animate-pulse"
            )}
            aria-label="Capture page"
          >
            {isProcessing ? (
              <Loader2 className="h-6 w-6 text-primary-foreground animate-spin" />
            ) : (
              <Camera className="h-6 w-6 text-primary-foreground" />
            )}
          </button>

          <Button
            onClick={handleBatchUpload}
            disabled={capturedPages.length === 0 || isUploading || isProcessing}
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
