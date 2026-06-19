import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  X, Camera, Trash2, RotateCcw, Loader2, FileText, Image as ImageIcon,
  Edit2, Zap, ZapOff, ArrowLeft, ArrowRight, RotateCw, Upload, FileUp,
  Eye, Bug, ClipboardCheck, Settings as SettingsIcon,
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { hasHomeIndicator } from '@/utils/mobileDetection';
import jsPDF from 'jspdf';
import { detectDocumentEdges, DetectedCorners } from '@/utils/documentEdgeDetection';
import {
  detectDocumentEdgesOpenCV, loadOpenCV, isOpenCVAvailable, DetectedCornersExt,
} from '@/utils/documentEdgeDetectionOpenCV';
import { CornerStabilityBuffer, validateQuadrilateral, StabilityResult } from '@/utils/documentStability';
import { enhanceDocumentPro } from '@/utils/documentEnhancementPro';
import { ManualCropOverlay } from './ManualCropOverlay';
import { ScannerQAReview } from './ScannerQAReview';
import { analyzeFrameQuality, evaluateQualityGate, QualityFlags, QualityGateResult } from '@/utils/documentQuality';
import { classifyAspectRatio, dominantPageSize, getPageSpec, DetectedPageSize } from '@/utils/documentPageSize';
import { deskewCanvas } from '@/utils/documentDeskew';
import { getTorchCapability, setTorch } from '@/utils/cameraTorch';
import {
  SCAN_PRESETS, DEFAULT_SCAN_PRESET, ScanPreset,
  PDF_PROFILES, DEFAULT_PDF_PROFILE, PdfProfile,
  captureHighResFrame, applyContinuousFocus, classifyShadowSeverity,
  inwardInsetCanvas, rotateBlob, CaptureMethod, ShadowSeverity,
} from '@/utils/scannerExtras';
import { computeImageHash, hammingDistance, DUPLICATE_HAMMING_THRESHOLD } from '@/utils/scannerImageHash';
import { analyzeEdgeForInset } from '@/utils/scannerEdgeAnalysis';
import {
  saveScanSession, loadScanSession, clearScanSession,
  makeScannerSessionId, PersistedScanPage,
  purgeExpiredScanSessions, DEFAULT_SESSION_TTL_MS,
} from '@/utils/scannerSessionStore';
import { renderImportedPdf, getPdfjsDiagnostics } from '@/utils/scannerPdfImport';
import { ScannerTelemetry } from '@/utils/scannerTelemetry';
import { ObjectUrlRegistry, detectDeviceMemoryProfile } from '@/utils/scannerMobileGuards';
import ScannerSettingsPanel, { type ScannerSettings } from './ScannerSettingsPanel';

interface CapturedPage {
  blob: Blob;
  preview: string;
  cropMode: 'auto' | 'manual';
  colorMode: 'color' | 'bw';
  preset: ScanPreset;
  confidence: number | null;
  pageSize: DetectedPageSize;
  pageSizeOverride?: DetectedPageSize | null;
  deskewAngle: number;
  quality: QualityFlags | null;
  captureMethod: CaptureMethod;
  sourceWidth: number;
  sourceHeight: number;
  outputWidth: number;
  outputHeight: number;
  shadowSeverity: ShadowSeverity;
  blurOverridden: boolean;
  rotationApplied: 0 | 90 | 180 | 270;
  imageHash?: string;
  edgeCleanupApplied?: boolean;
  duplicateWarning?: boolean;
}

const SCANNER_VERSION = '2.3.0';
const HOLD_STILL_MS = 350;
const AUTOCAPTURE_HOLD_MS = 1000;
const AUTOCAPTURE_COOLDOWN_MS = 1500;

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
  // Core capture state
  const [capturedPages, setCapturedPages] = useState<CapturedPage[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [detectedCorners, setDetectedCorners] = useState<DetectedCornersExt | null>(null);
  const [stabilityResult, setStabilityResult] = useState<StabilityResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [videoWidth, setVideoWidth] = useState(0);
  const [videoHeight, setVideoHeight] = useState(0);
  const [opencvLoading, setOpencvLoading] = useState(false);
  const [opencvReady, setOpencvReady] = useState(false);
  const [opencvFailed, setOpencvFailed] = useState(false);
  const [qualityGate, setQualityGate] = useState<QualityGateResult | null>(null);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  // Preferences
  const [scanPreset, setScanPreset] = useState<ScanPreset>(DEFAULT_SCAN_PRESET);
  const [pdfProfile, setPdfProfile] = useState<PdfProfile>(DEFAULT_PDF_PROFILE);
  const [autoCapture, setAutoCapture] = useState(false);
  const [burnPageNumbers, setBurnPageNumbers] = useState(false);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [retakeIndex, setRetakeIndex] = useState<number | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [autoCountdown, setAutoCountdown] = useState<number | null>(null);

  // Manual crop state
  const [showManualCrop, setShowManualCrop] = useState(false);
  const [manualCropImage, setManualCropImage] = useState<{ url: string; width: number; height: number } | null>(null);
  const [pendingCaptureCanvas, setPendingCaptureCanvas] = useState<HTMLCanvasElement | null>(null);
  const [pendingCaptureMeta, setPendingCaptureMeta] = useState<{
    method: CaptureMethod; sourceWidth: number; sourceHeight: number;
  } | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectionIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const stabilityBufferRef = useRef(new CornerStabilityBuffer());
  const autoStableSinceRef = useRef<number | null>(null);
  const lastAutoCaptureAtRef = useRef<number>(0);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const capturingRef = useRef<boolean>(false);
  const scannerSessionIdRef = useRef<string>(makeScannerSessionId());
  const isDev = typeof import.meta !== 'undefined' && (import.meta as any).env?.DEV;


  // Production-hardening refs (telemetry, URL registry, autosave state, mobile profile, pdf.js diag)
  const telemetryRef = useRef<ScannerTelemetry>(new ScannerTelemetry());
  const urlRegRef = useRef<ObjectUrlRegistry>(new ObjectUrlRegistry());
  const autosaveEnabledRef = useRef<boolean>(true);
  const autosaveDisabledReasonRef = useRef<string | null>(null);
  const autosaveBytesRef = useRef<number>(0);
  const deviceProfileRef = useRef(detectDeviceMemoryProfile());
  const cameraStartTsRef = useRef<number>(0);
  const opencvStartTsRef = useRef<number>(0);
  const userPickedProfileRef = useRef<boolean>(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [autosaveEnabled, setAutosaveEnabled] = useState(true);

  // Phase additions
  const [showQA, setShowQA] = useState(false);
  const [resumePromptSession, setResumePromptSession] = useState<{ pages: number; updatedAt: number } | null>(null);
  const [pendingResumePages, setPendingResumePages] = useState<PersistedScanPage[] | null>(null);
  const [importPdfChoice, setImportPdfChoice] = useState<File | null>(null);

  // Preload OpenCV
  useEffect(() => {
    if (isOpenCVAvailable()) { setOpencvReady(true); return; }
    const kick = () => {
      setOpencvLoading(true);
      loadOpenCV()
        .then((ok) => { setOpencvReady(!!ok); setOpencvFailed(!ok); })
        .finally(() => setOpencvLoading(false));
    };
    const ric = (window as any).requestIdleCallback;
    if (ric) {
      const id = ric(kick, { timeout: 1500 });
      return () => (window as any).cancelIdleCallback?.(id);
    }
    const t = setTimeout(kick, 200);
    return () => clearTimeout(t);
  }, []);

  // Camera lifecycle + resume check
  useEffect(() => {
    if (open) {
      startCamera();
      stabilityBufferRef.current.reset();
      autoStableSinceRef.current = null;
      scannerSessionIdRef.current = makeScannerSessionId();
      // Check for unfinished session
      loadScanSession(pipelineEntryId, documentType).then((existing) => {
        if (existing && existing.pages.length > 0) {
          setResumePromptSession({ pages: existing.pages.length, updatedAt: existing.updatedAt });
          setPendingResumePages(existing.pages);
          if (existing.scannerSessionId) scannerSessionIdRef.current = existing.scannerSessionId;
        }
      });
    } else {
      stopCamera();
      capturedPages.forEach(p => URL.revokeObjectURL(p.preview));
      setCapturedPages([]);
      setCameraError(null);
      setDetectedCorners(null);
      setStabilityResult(null);
      setShowManualCrop(false);
      setManualCropImage(null);
      setPendingCaptureCanvas(null);
      setPendingCaptureMeta(null);
      setRetakeIndex(null);
      setPreviewIndex(null);
      setAutoCountdown(null);
      setShowQA(false);
      setResumePromptSession(null);
      setPendingResumePages(null);
    }
    return () => { stopCamera(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Autosave: every time pages change, persist to IndexedDB
  useEffect(() => {
    if (!open || capturedPages.length === 0) return;
    const t = setTimeout(() => {
      saveScanSession({
        id: `${pipelineEntryId}::${documentType}`,
        scannerSessionId: scannerSessionIdRef.current,
        pipelineEntryId,
        documentType,
        documentLabel,
        scanPreset,
        pdfProfile,
        scannerVersion: SCANNER_VERSION,
        updatedAt: Date.now(),
        pages: capturedPages.map(p => ({
          blob: p.blob,
          cropMode: p.cropMode,
          colorMode: p.colorMode,
          preset: p.preset,
          pageSize: p.pageSize,
          deskewAngle: p.deskewAngle,
          confidence: p.confidence,
          outputWidth: p.outputWidth,
          outputHeight: p.outputHeight,
          sourceWidth: p.sourceWidth,
          sourceHeight: p.sourceHeight,
          rotationApplied: p.rotationApplied,
          captureMethod: p.captureMethod,
          shadowSeverity: p.shadowSeverity,
          blurOverridden: p.blurOverridden,
          imageHash: p.imageHash,
          pageSizeOverride: p.pageSizeOverride ?? null,
          edgeCleanupApplied: p.edgeCleanupApplied,
          duplicateWarning: p.duplicateWarning,
          quality: p.quality,
        })),
      });
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, capturedPages, scanPreset, pdfProfile]);

  // Detection loop
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

      if (video.videoWidth !== videoWidth || video.videoHeight !== videoHeight) {
        setVideoWidth(video.videoWidth);
        setVideoHeight(video.videoHeight);
      }

      const tempCanvas = document.createElement('canvas');
      const scale = 2;
      tempCanvas.width = Math.floor(video.videoWidth / scale);
      tempCanvas.height = Math.floor(video.videoHeight / scale);
      const ctx = tempCanvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(video, 0, 0, tempCanvas.width, tempCanvas.height);
      const imageData = ctx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);

      let corners: DetectedCornersExt | null = null;
      if (isOpenCVAvailable()) {
        corners = (await detectDocumentEdgesOpenCV(imageData)) as DetectedCornersExt | null;
      }
      if (!corners) {
        const fb = detectDocumentEdges(imageData);
        if (fb) corners = { ...fb } as DetectedCornersExt;
      }

      const flags = analyzeFrameQuality(imageData);
      const gate = evaluateQualityGate(flags);
      setQualityGate(gate);

      if (corners) {
        const scaled: DetectedCornersExt = {
          topLeft: { x: corners.topLeft.x * scale, y: corners.topLeft.y * scale },
          topRight: { x: corners.topRight.x * scale, y: corners.topRight.y * scale },
          bottomRight: { x: corners.bottomRight.x * scale, y: corners.bottomRight.y * scale },
          bottomLeft: { x: corners.bottomLeft.x * scale, y: corners.bottomLeft.y * scale },
          confidence: corners.confidence,
          aspectRatio: corners.aspectRatio,
          pageSize: corners.pageSize,
        };
        const stability = stabilityBufferRef.current.addFrame(scaled);
        setStabilityResult(stability);
        const display: DetectedCornersExt = stability.averagedCorners
          ? { ...stability.averagedCorners, aspectRatio: scaled.aspectRatio, pageSize: scaled.pageSize }
          : scaled;
        setDetectedCorners(display);

        // Auto-capture countdown logic
        if (autoCapture && stability.stable && !gate.block) {
          const now = Date.now();
          if (autoStableSinceRef.current === null) autoStableSinceRef.current = now;
          const heldFor = now - autoStableSinceRef.current;
          const cooledDown = now - lastAutoCaptureAtRef.current > AUTOCAPTURE_COOLDOWN_MS;
          const remaining = Math.max(0, Math.ceil((AUTOCAPTURE_HOLD_MS - heldFor) / 1000));
          setAutoCountdown(remaining);
          if (heldFor >= AUTOCAPTURE_HOLD_MS && cooledDown && !isProcessing) {
            lastAutoCaptureAtRef.current = now;
            autoStableSinceRef.current = null;
            setAutoCountdown(null);
            void captureAndProcess();
          }
        } else {
          autoStableSinceRef.current = null;
          setAutoCountdown(null);
        }
      } else {
        stabilityBufferRef.current.addFrame(null);
        setDetectedCorners(null);
        setStabilityResult(null);
        autoStableSinceRef.current = null;
        setAutoCountdown(null);
      }
    };

    detectionIntervalRef.current = setInterval(runDetection, 200);
    return () => {
      if (detectionIntervalRef.current) {
        clearInterval(detectionIntervalRef.current);
        detectionIntervalRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraReady, videoWidth, videoHeight, autoCapture, isProcessing]);

  const startCamera = async () => {
    setCameraReady(false);
    setCameraError(null);
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 2560, min: 1280 },
          height: { ideal: 1440, min: 720 },
        } as MediaTrackConstraints,
        audio: false,
      });
      streamRef.current = mediaStream;
      // Best-effort continuous focus / exposure / white balance
      void applyContinuousFocus(mediaStream);
      const cap = getTorchCapability(mediaStream);
      setTorchSupported(cap.supported);
      setTorchOn(false);

      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
        videoRef.current.onloadedmetadata = () => setCameraReady(true);
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
      setTorch(streamRef.current, false).catch(() => {});
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setCameraReady(false);
    setDetectedCorners(null);
    setStabilityResult(null);
    setTorchOn(false);
    setTorchSupported(false);
    setQualityGate(null);
  };

  // ============================================================================
  // Process & add page
  // ============================================================================

  const processAndAddPage = useCallback(async (
    sourceCanvas: HTMLCanvasElement,
    corners: DetectedCornersExt,
    cropMode: 'auto' | 'manual',
    capturedQuality: QualityFlags | null,
    captureMeta: { method: CaptureMethod; sourceWidth: number; sourceHeight: number },
    blurOverridden: boolean,
  ): Promise<boolean> => {
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

      // Final-quad area sanity: must be 10–95% of source.
      const polyArea = (() => {
        const pts = [corners.topLeft, corners.topRight, corners.bottomRight, corners.bottomLeft];
        let a = 0;
        for (let i = 0; i < pts.length; i++) {
          const j = (i + 1) % pts.length;
          a += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
        }
        return Math.abs(a) / 2;
      })();
      const frameArea = sourceCanvas.width * sourceCanvas.height;
      const ratio = polyArea / Math.max(1, frameArea);
      if (ratio < 0.10) {
        toast({ title: 'Crop too small', description: 'Selected page is under 10% of the frame.', variant: 'destructive' });
        return false;
      }
      if (ratio > 0.95 && cropMode === 'auto') {
        toast({ title: 'Crop confirmation needed', description: 'Auto-crop matched the whole frame. Use manual crop.', variant: 'destructive' });
        return false;
      }

      // Page-size estimation
      const w1 = Math.hypot(corners.topRight.x - corners.topLeft.x, corners.topRight.y - corners.topLeft.y);
      const w2 = Math.hypot(corners.bottomRight.x - corners.bottomLeft.x, corners.bottomRight.y - corners.bottomLeft.y);
      const h1 = Math.hypot(corners.bottomLeft.x - corners.topLeft.x, corners.bottomLeft.y - corners.topLeft.y);
      const h2 = Math.hypot(corners.bottomRight.x - corners.topRight.x, corners.bottomRight.y - corners.topRight.y);
      const longSide = Math.max((w1 + w2) / 2, (h1 + h2) / 2);
      const shortSide = Math.max(1, Math.min((w1 + w2) / 2, (h1 + h2) / 2));
      const pageSize: DetectedPageSize = corners.pageSize ?? classifyAspectRatio(longSide, shortSide);
      const spec = getPageSpec(pageSize);

      const preset = SCAN_PRESETS[scanPreset];
      let enhanced = enhanceDocumentPro(sourceCanvas, corners, {
        mode: preset.colorMode,
        illuminationCorrection: preset.illuminationCorrection,
        whiteBackground: preset.whiteBackground,
        sharpen: preset.sharpen,
        outputWidth: spec.outputWidth,
        outputHeight: spec.outputHeight,
      });

      // Post-warp deskew (±5°)
      const { canvas: deskewed, angle: deskewAngle } = deskewCanvas(enhanced);
      enhanced = deskewed;

      // Content-aware edge cleanup: skip inset if dark ink (signatures/stamps)
      // sits near the page edges.
      const edgeAnalysis = analyzeEdgeForInset(enhanced);
      let edgeCleanupApplied = false;
      if (edgeAnalysis.applyInset && preset.inwardInsetPct > 0) {
        enhanced = inwardInsetCanvas(enhanced, preset.inwardInsetPct);
        edgeCleanupApplied = true;
      }

      // Optional page-number badge (off by default)
      if (burnPageNumbers) {
        const pageNum = retakeIndex !== null ? retakeIndex + 1 : capturedPages.length + 1;
        const ectx = enhanced.getContext('2d');
        if (ectx) {
          ectx.fillStyle = 'rgba(0,0,0,0.6)';
          ectx.fillRect(enhanced.width - 120, 15, 100, 40);
          ectx.fillStyle = 'white';
          ectx.font = 'bold 24px sans-serif';
          ectx.fillText(`Page ${pageNum}`, enhanced.width - 110, 45);
        }
      }

      const shadowSeverity = classifyShadowSeverity(capturedQuality);

      const blob: Blob | null = await new Promise((resolve) =>
        enhanced.toBlob((b) => resolve(b), 'image/jpeg', 0.95)
      );
      if (!blob) return false;
      const preview = URL.createObjectURL(blob);

      // Perceptual hash + duplicate check against previous page
      const imageHash = await computeImageHash(blob);
      let duplicateWarning = false;
      const prev = capturedPages[capturedPages.length - 1];
      if (prev?.imageHash && imageHash && retakeIndex === null) {
        const dist = hammingDistance(prev.imageHash, imageHash);
        if (dist <= DUPLICATE_HAMMING_THRESHOLD) {
          duplicateWarning = true;
          const proceed = confirm('This page looks like the previous scan. Add anyway?');
          if (!proceed) {
            URL.revokeObjectURL(preview);
            return false;
          }
        }
      }

      const newPage: CapturedPage = {
        blob,
        preview,
        cropMode,
        colorMode: preset.colorMode,
        preset: scanPreset,
        confidence: corners.confidence ?? null,
        pageSize,
        deskewAngle,
        quality: capturedQuality,
        captureMethod: captureMeta.method,
        sourceWidth: captureMeta.sourceWidth,
        sourceHeight: captureMeta.sourceHeight,
        outputWidth: enhanced.width,
        outputHeight: enhanced.height,
        shadowSeverity,
        blurOverridden,
        rotationApplied: 0,
        imageHash,
        edgeCleanupApplied,
        duplicateWarning,
      };
      setCapturedPages(prev => {
        if (retakeIndex !== null && prev[retakeIndex]) {
          URL.revokeObjectURL(prev[retakeIndex].preview);
          const next = [...prev];
          next[retakeIndex] = newPage;
          return next;
        }
        return [...prev, newPage];
      });
      setRetakeIndex(null);
      return true;
    } catch (error) {
      console.error('Processing error:', error);
      return false;
    }
  }, [capturedPages, scanPreset, burnPageNumbers, retakeIndex]);

  // ============================================================================
  // Capture
  // ============================================================================

  const captureAndProcess = useCallback(async () => {
    if (!videoRef.current || !cameraReady) return;
    // Hard duplicate-capture guard (state is too slow to prevent rapid double taps)
    if (capturingRef.current) return;
    capturingRef.current = true;
    // Cancel any active auto-capture countdown — manual tap wins.
    autoStableSinceRef.current = null;
    setAutoCountdown(null);

    setIsProcessing(true);
    try {
      // Hold-still delay if stable, then re-check quality.
      const currentStability = stabilityBufferRef.current.getResult();
      if (currentStability.stable) {
        await new Promise(r => setTimeout(r, HOLD_STILL_MS));
      }

      // Capture highest-resolution still available
      const hi = await captureHighResFrame(videoRef.current, streamRef.current);
      const captureMeta = {
        method: hi.method, sourceWidth: hi.sourceWidth, sourceHeight: hi.sourceHeight,
      };

      // Re-check blur on the final still
      const recheckCtx = hi.canvas.getContext('2d');
      let finalQuality = qualityGate?.flags ?? null;
      let blurOverridden = false;
      if (recheckCtx) {
        // Downsample for blur check
        const scale = Math.max(1, Math.floor(hi.canvas.width / 800));
        const sw = Math.floor(hi.canvas.width / scale);
        const sh = Math.floor(hi.canvas.height / scale);
        const dc = document.createElement('canvas');
        dc.width = sw; dc.height = sh;
        const dctx = dc.getContext('2d');
        if (dctx) {
          dctx.drawImage(hi.canvas, 0, 0, sw, sh);
          finalQuality = analyzeFrameQuality(dctx.getImageData(0, 0, sw, sh));
        }
      }
      const recheckGate = finalQuality ? evaluateQualityGate(finalQuality) : null;
      if (recheckGate?.block && recheckGate.message?.startsWith('Image looks blurry')) {
        const proceed = confirm('Image looks blurry. Capture anyway?');
        if (!proceed) {
          setIsProcessing(false);
          capturingRef.current = false;
          return;
        }
        blurOverridden = true;
      }

      // Use stability-averaged corners scaled to the high-res frame
      let cornersForCapture: DetectedCornersExt | null = null;
      if (currentStability.stable && currentStability.averagedCorners && videoWidth > 0) {
        const sx = hi.canvas.width / videoWidth;
        const sy = hi.canvas.height / videoHeight;
        const c = currentStability.averagedCorners as DetectedCornersExt;
        cornersForCapture = {
          topLeft: { x: c.topLeft.x * sx, y: c.topLeft.y * sy },
          topRight: { x: c.topRight.x * sx, y: c.topRight.y * sy },
          bottomRight: { x: c.bottomRight.x * sx, y: c.bottomRight.y * sy },
          bottomLeft: { x: c.bottomLeft.x * sx, y: c.bottomLeft.y * sy },
          confidence: c.confidence,
          aspectRatio: c.aspectRatio,
          pageSize: c.pageSize,
        };
      }

      const blockedByQuality = (recheckGate?.block ?? qualityGate?.block) && !blurOverridden;

      if (cornersForCapture && !blockedByQuality) {
        const ok = await processAndAddPage(
          hi.canvas, cornersForCapture, 'auto', finalQuality, captureMeta, blurOverridden,
        );
        if (!ok) {
          toast({ title: 'Processing Failed', description: 'Please try again.', variant: 'destructive' });
        }
      } else {
        // Manual crop fallback
        if (blockedByQuality && (recheckGate?.message || qualityGate?.message)) {
          toast({
            title: 'Capture blocked',
            description: recheckGate?.message ?? qualityGate?.message ?? 'Quality gate blocked auto-crop.',
            variant: 'destructive',
          });
        }
        setPendingCaptureCanvas(hi.canvas);
        setPendingCaptureMeta(captureMeta);
        hi.canvas.toBlob((blob) => {
          if (blob) {
            setManualCropImage({
              url: URL.createObjectURL(blob),
              width: hi.canvas.width,
              height: hi.canvas.height,
            });
            setShowManualCrop(true);
          }
        }, 'image/jpeg', 0.9);
      }
    } catch (error) {
      console.error('Capture error:', error);
      toast({ title: 'Capture Failed', description: 'Failed to capture. Try again.', variant: 'destructive' });
    } finally {
      setIsProcessing(false);
      capturingRef.current = false;
    }
  }, [cameraReady, processAndAddPage, qualityGate, videoWidth, videoHeight]);

  const handleManualCropConfirm = useCallback(async (corners: DetectedCorners) => {
    if (!pendingCaptureCanvas || !pendingCaptureMeta) return;
    setIsProcessing(true);
    setShowManualCrop(false);
    try {
      const ok = await processAndAddPage(
        pendingCaptureCanvas, corners as DetectedCornersExt, 'manual',
        qualityGate?.flags ?? null, pendingCaptureMeta, false,
      );
      if (!ok) {
        toast({ title: 'Processing Failed', description: 'Please try again.', variant: 'destructive' });
      }
    } finally {
      setIsProcessing(false);
      if (manualCropImage) URL.revokeObjectURL(manualCropImage.url);
      setManualCropImage(null);
      setPendingCaptureCanvas(null);
      setPendingCaptureMeta(null);
    }
  }, [pendingCaptureCanvas, pendingCaptureMeta, processAndAddPage, manualCropImage, qualityGate]);

  const handleManualCropCancel = useCallback(() => {
    setShowManualCrop(false);
    if (manualCropImage) URL.revokeObjectURL(manualCropImage.url);
    setManualCropImage(null);
    setPendingCaptureCanvas(null);
    setPendingCaptureMeta(null);
    setRetakeIndex(null);
  }, [manualCropImage]);

  // ============================================================================
  // Page list manipulation
  // ============================================================================

  const removePage = (index: number) => {
    setCapturedPages(prev => {
      const next = [...prev];
      URL.revokeObjectURL(next[index].preview);
      next.splice(index, 1);
      return next;
    });
  };

  const movePage = (index: number, delta: -1 | 1) => {
    setCapturedPages(prev => {
      const target = index + delta;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const rotatePage = async (index: number, degrees: 90 | -90 | 180) => {
    const page = capturedPages[index];
    if (!page) return;
    setIsProcessing(true);
    try {
      const rotated = await rotateBlob(page.blob, degrees);
      const preview = URL.createObjectURL(rotated);
      URL.revokeObjectURL(page.preview);
      const norm = ((page.rotationApplied + (degrees === -90 ? 270 : degrees)) % 360) as 0 | 90 | 180 | 270;
      const newOutputWidth = degrees === 180 ? page.outputWidth : page.outputHeight;
      const newOutputHeight = degrees === 180 ? page.outputHeight : page.outputWidth;
      setCapturedPages(prev => {
        const next = [...prev];
        next[index] = {
          ...page,
          blob: rotated,
          preview,
          rotationApplied: norm,
          outputWidth: newOutputWidth,
          outputHeight: newOutputHeight,
        };
        return next;
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const startRetake = (index: number) => {
    setRetakeIndex(index);
    setPreviewIndex(null);
    toast({ title: 'Retake mode', description: `Next capture replaces page ${index + 1}.` });
  };

  // ============================================================================
  // Import paths
  // ============================================================================

  const handleImportPhoto = async (file: File) => {
    setIsProcessing(true);
    try {
      const bitmap = await createImageBitmap(file);
      const c = document.createElement('canvas');
      c.width = bitmap.width;
      c.height = bitmap.height;
      const ctx = c.getContext('2d');
      if (!ctx) { bitmap.close(); return; }
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close();
      setPendingCaptureCanvas(c);
      setPendingCaptureMeta({
        method: 'imported_photo', sourceWidth: c.width, sourceHeight: c.height,
      });
      const url = URL.createObjectURL(file);
      setManualCropImage({ url, width: c.width, height: c.height });
      setShowManualCrop(true);
    } catch (e) {
      console.error('Photo import failed:', e);
      toast({ title: 'Import failed', description: 'Could not read photo.', variant: 'destructive' });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleImportPdf = async (file: File) => {
    setIsUploading(true);
    setUploadProgress(0);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { data: profile } = await supabase
        .from('profiles').select('tenant_id').eq('id', user.id).single();
      if (!profile?.tenant_id) throw new Error('Tenant not found');

      const timestamp = Date.now();
      const sanitizedLabel = documentLabel.replace(/\s+/g, '_');
      const fileName = `${profile.tenant_id}/${pipelineEntryId}/${timestamp}_${documentType}.pdf`;
      setUploadProgress(40);

      const { error: uploadError } = await supabase.storage
        .from('documents').upload(fileName, file, { contentType: 'application/pdf' });
      if (uploadError) throw uploadError;
      setUploadProgress(80);

      const scanMetadata = {
        scanned: false,
        imported: true,
        capture_method: 'imported_pdf' as CaptureMethod,
        document_type: documentType,
        document_label: documentLabel,
        scanner_version: SCANNER_VERSION,
        scanner_session_id: scannerSessionIdRef.current,
        captured_at: new Date(timestamp).toISOString(),
        storage_path: fileName,
        original_filename: file.name,
        final_size_bytes: file.size,
        imported_pdf_mode: 'original' as const,
        original_file_size_bytes: file.size,
      };

      const { data: insertedDoc, error: dbError } = await supabase
        .from('documents').insert({
          tenant_id: profile.tenant_id,
          pipeline_entry_id: pipelineEntryId,
          document_type: documentType,
          filename: `${sanitizedLabel}.pdf`,
          file_path: fileName,
          file_size: file.size,
          mime_type: 'application/pdf',
          uploaded_by: user.id,
          description: `Imported ${documentLabel}`,
          scan_source: 'imported_pdf',
          metadata: scanMetadata,
          ocr_status: 'processing',
        } as any).select('id').single();
      if (dbError) throw dbError;
      if (insertedDoc?.id) {
        supabase.functions.invoke('ocr-scanned-document', { body: { document_id: insertedDoc.id } })
          .catch(e => console.warn('[scanner] OCR invoke failed:', e));
      }
      setUploadProgress(100);
      toast({ title: 'PDF Imported', description: `${file.name} uploaded.` });
      onOpenChange(false);
      onUploadComplete?.();
    } catch (err: any) {
      console.error('PDF import error:', err);
      toast({ title: 'Import failed', description: err.message || 'Could not import PDF.', variant: 'destructive' });
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  // Lazy-render imported PDF pages through pdf.js and stage them as scans.
  // On any failure, falls back to uploading the original PDF.
  const handleImportPdfRebuild = async (file: File) => {
    setIsProcessing(true);
    try {
      let rendered;
      try {
        rendered = await renderImportedPdf(file, { targetDpi: 220, maxPages: 50 });
      } catch (e) {
        console.warn('[scanner] pdf.js unavailable, falling back to original upload', e);
        toast({
          title: 'PDF cleanup unavailable',
          description: 'Cleanup engine could not load. Uploading original PDF instead.',
        });
        await handleImportPdf(file);
        return;
      }
      if (!rendered.length) {
        toast({ title: 'Empty PDF', description: 'No pages could be rendered.', variant: 'destructive' });
        return;
      }
      const newPages: CapturedPage[] = [];
      for (const r of rendered) {
        const blob: Blob | null = await new Promise((resolve) =>
          r.canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.92),
        );
        if (!blob) continue;
        const hash = await computeImageHash(blob);
        const ratio = r.heightPx / r.widthPx;
        const pageSize: DetectedPageSize =
          Math.abs(ratio - 11 / 8.5) < 0.05 ? 'letter'
            : Math.abs(ratio - 14 / 8.5) < 0.05 ? 'legal'
              : Math.abs(ratio - 297 / 210) < 0.05 ? 'a4'
                : 'unknown';
        newPages.push({
          blob,
          preview: URL.createObjectURL(blob),
          cropMode: 'auto',
          colorMode: 'color',
          preset: scanPreset,
          confidence: 1,
          pageSize,
          deskewAngle: 0,
          quality: null,
          captureMethod: 'imported_pdf_rebuilt',
          sourceWidth: r.widthPx,
          sourceHeight: r.heightPx,
          outputWidth: r.widthPx,
          outputHeight: r.heightPx,
          shadowSeverity: 'none',
          blurOverridden: false,
          rotationApplied: 0,
          imageHash: hash,
          edgeCleanupApplied: false,
          duplicateWarning: false,
        });
      }
      setCapturedPages(prev => [...prev, ...newPages]);
      toast({
        title: 'PDF rebuilt',
        description: `${newPages.length} page${newPages.length === 1 ? '' : 's'} added — review and upload when ready.`,
      });
    } finally {
      setIsProcessing(false);
    }
  };


  // ============================================================================
  // PDF build
  // ============================================================================

  const blobToDataURL = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onloadend = () => resolve(r.result as string);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });

  const reencodePageBlob = async (blob: Blob, quality: number, maxWidth?: number): Promise<Blob> => {
    const bitmap = await createImageBitmap(blob);
    let { width, height } = bitmap;
    if (maxWidth && width > maxWidth) {
      const ratio = maxWidth / width;
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);
    }
    const c = document.createElement('canvas');
    c.width = width; c.height = height;
    const ctx = c.getContext('2d');
    if (!ctx) { bitmap.close(); return blob; }
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    return new Promise<Blob>((resolve) =>
      c.toBlob(b => resolve(b ?? blob), 'image/jpeg', quality),
    );
  };

  const buildPdfAtQuality = async (
    pages: CapturedPage[], quality: number, maxImageDpi: number,
  ): Promise<{ blob: Blob; pdfFormat: 'letter' | 'legal' | 'a4' }> => {
    const dominant = dominantPageSize(pages.map(p => p.pageSize));
    const pdfFormat: 'letter' | 'legal' | 'a4' = dominant === 'unknown' ? 'letter' : dominant;
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'in', format: pdfFormat, compress: true });
    for (let i = 0; i < pages.length; i++) {
      const pageSpec = getPageSpec(pages[i].pageSize === 'unknown' ? dominant : pages[i].pageSize);
      if (i > 0) pdf.addPage([pageSpec.widthIn, pageSpec.heightIn], 'portrait');
      const baseQuality = pages[i].colorMode === 'bw' ? Math.min(quality, 0.82) : quality;
      const maxWidth = Math.round(pageSpec.widthIn * maxImageDpi);
      const reencoded = await reencodePageBlob(pages[i].blob, baseQuality, maxWidth);
      const dataUrl = await blobToDataURL(reencoded);
      pdf.addImage(dataUrl, 'JPEG', 0, 0, pageSpec.widthIn, pageSpec.heightIn, undefined, 'SLOW');
    }
    return { blob: pdf.output('blob'), pdfFormat };
  };

  const generateCombinedPDF = async (pages: CapturedPage[]): Promise<{
    blob: Blob; dpi: number; quality: number; compressed: boolean;
    pdfFormat: 'letter' | 'legal' | 'a4'; ladderUsed: Array<{ quality: number; dpi: number }>;
  }> => {
    const cfg = PDF_PROFILES[pdfProfile];
    // Profile-specific ladders
    const ladder: Array<{ quality: number; dpi: number }> = pdfProfile === 'standard'
      ? [
          { quality: cfg.jpegQuality, dpi: cfg.dpi },
          { quality: 0.72, dpi: 200 },
          { quality: 0.65, dpi: 200 },
        ]
      : pdfProfile === 'high'
        ? [{ quality: cfg.jpegQuality, dpi: cfg.dpi }, { quality: 0.78, dpi: 280 }]
        : [{ quality: cfg.jpegQuality, dpi: cfg.dpi }];

    let last: { blob: Blob; pdfFormat: 'letter' | 'legal' | 'a4' } | null = null;
    let lastStep = ladder[0];
    const used: Array<{ quality: number; dpi: number }> = [];
    for (let i = 0; i < ladder.length; i++) {
      const step = ladder[i];
      used.push(step);
      const out = await buildPdfAtQuality(pages, step.quality, step.dpi);
      last = out;
      lastStep = step;
      if (out.blob.size <= cfg.maxBytes) {
        return { blob: out.blob, dpi: step.dpi, quality: step.quality, compressed: i > 0, pdfFormat: out.pdfFormat, ladderUsed: used };
      }
    }
    return {
      blob: last!.blob, dpi: lastStep.dpi, quality: lastStep.quality, compressed: true,
      pdfFormat: last!.pdfFormat, ladderUsed: used,
    };
  };

  // ============================================================================
  // Upload
  // ============================================================================

  const handleBatchUpload = async (qaAcknowledged: boolean = false) => {
    if (capturedPages.length === 0) {
      toast({ title: 'No Pages', description: 'Capture at least one page.', variant: 'destructive' });
      return;
    }
    setIsUploading(true);
    setUploadProgress(0);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { data: profile } = await supabase
        .from('profiles').select('tenant_id').eq('id', user.id).single();
      if (!profile?.tenant_id) throw new Error('Tenant not found');

      setUploadProgress(10);
      const profileCfg = PDF_PROFILES[pdfProfile];
      const { blob: pdfBlob, dpi, quality, compressed, pdfFormat, ladderUsed } =
        await generateCombinedPDF(capturedPages);

      if (pdfBlob.size > profileCfg.maxBytes && !profileCfg.allowOverLimit) {
        throw new Error(
          `PDF is ${(pdfBlob.size / 1024 / 1024).toFixed(1)}MB after compression and exceeds the ${(profileCfg.maxBytes / 1024 / 1024).toFixed(0)}MB ${profileCfg.label} limit. ` +
          'Try High/Archive quality, fewer pages, or Contract preset.'
        );
      }
      if (pdfBlob.size > profileCfg.maxBytes && profileCfg.allowOverLimit) {
        const proceed = confirm(
          `PDF is ${(pdfBlob.size / 1024 / 1024).toFixed(1)}MB — exceeds typical ${(profileCfg.maxBytes / 1024 / 1024).toFixed(0)}MB. Upload anyway?`
        );
        if (!proceed) { setIsUploading(false); setUploadProgress(0); return; }
      }
      if (compressed) {
        toast({
          title: 'PDF Compressed',
          description: `Adjusted quality to keep file size manageable (${(pdfBlob.size / 1024 / 1024).toFixed(1)}MB).`,
        });
      }
      setUploadProgress(50);

      const timestamp = Date.now();
      const sanitizedLabel = documentLabel.replace(/\s+/g, '_');
      const fileName = `${profile.tenant_id}/${pipelineEntryId}/${timestamp}_${documentType}.pdf`;

      const { error: uploadError } = await supabase.storage
        .from('documents').upload(fileName, pdfBlob, { contentType: 'application/pdf' });
      if (uploadError) throw uploadError;
      setUploadProgress(80);

      // Aggregate metadata
      const confidences = capturedPages.map(p => p.confidence).filter((c): c is number => typeof c === 'number');
      const avgConfidence = confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : null;
      const pageSizesArr = capturedPages.map(p => p.pageSize);
      const detected_page_size = dominantPageSize(pageSizesArr);
      const captureMethods = capturedPages.map(p => p.captureMethod);
      const presets = capturedPages.map(p => p.preset);
      const shadowSeverityCounts: Record<ShadowSeverity, number> = { none: 0, light: 0, moderate: 0, heavy: 0 };
      capturedPages.forEach(p => { shadowSeverityCounts[p.shadowSeverity]++; });

      const scanMetadata = {
        scanned: true,
        document_type: documentType,
        document_label: documentLabel,
        scan_preset: scanPreset,
        enhancement_profile: SCAN_PRESETS[scanPreset].enhancementProfile,
        color_mode: SCAN_PRESETS[scanPreset].colorMode,
        page_count: capturedPages.length,
        dpi,
        jpeg_quality: quality,
        pdf_profile: pdfProfile,
        compression_ladder_used: ladderUsed,
        final_size_bytes: pdfBlob.size,
        output_format: 'pdf',
        pdf_format: pdfFormat,
        detected_page_size,
        page_sizes: pageSizesArr,
        capture_methods: captureMethods,
        presets_per_page: presets,
        burned_page_numbers: burnPageNumbers,
        auto_capture_used: autoCapture,
        torch_used: torchOn,
        torch_supported: torchSupported,
        scanner_version: SCANNER_VERSION,
        captured_at: new Date(timestamp).toISOString(),
        storage_path: fileName,
        compressed,
        scanner_session_id: scannerSessionIdRef.current,
        qa_reviewed: true,
        qa_warnings_acknowledged: qaAcknowledged,
        actual_size_bytes: pdfBlob.size,
        page_size_overrides: capturedPages.map(p => p.pageSizeOverride ?? null),
        edge_cleanup_applied: capturedPages.map(p => !!p.edgeCleanupApplied),
        duplicate_warning_pages: capturedPages.filter(p => p.duplicateWarning).length,
        imported_pdf_mode: capturedPages.every(p => p.captureMethod === 'imported_pdf_rebuilt') ? 'cleaned_rebuilt' as const : undefined,
      };

      const scanQuality = {
        average_detection_confidence: avgConfidence,
        manual_crop_pages: capturedPages.filter(p => p.cropMode === 'manual').length,
        auto_detected_pages: capturedPages.filter(p => p.cropMode === 'auto').length,
        color_mode_pages: capturedPages.filter(p => p.colorMode === 'color').length,
        bw_mode_pages: capturedPages.filter(p => p.colorMode === 'bw').length,
        average_deskew_angle_deg: (() => {
          const xs = capturedPages.map(p => Math.abs(p.deskewAngle ?? 0));
          return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
        })(),
        deskew_angles_deg: capturedPages.map(p => p.deskewAngle),
        glare_flagged_pages: capturedPages.filter(p => p.quality?.glare_detected).length,
        shadow_flagged_pages: capturedPages.filter(p => p.quality?.shadow_detected).length,
        low_light_flagged_pages: capturedPages.filter(p => p.quality?.low_light_detected).length,
        shadow_severity_counts: shadowSeverityCounts,
        per_page_shadow_severity: capturedPages.map(p => p.shadowSeverity),
        blur_overridden_pages: capturedPages.filter(p => p.blurOverridden).length,
        average_blur_score: (() => {
          const xs = capturedPages.map(p => p.quality?.blur_score).filter((x): x is number => typeof x === 'number');
          return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
        })(),
        per_page_flags: capturedPages.map(p => p.quality),
        per_page_source_dims: capturedPages.map(p => ({ w: p.sourceWidth, h: p.sourceHeight })),
        per_page_output_dims: capturedPages.map(p => ({ w: p.outputWidth, h: p.outputHeight })),
        per_page_rotation: capturedPages.map(p => p.rotationApplied),
      };

      const { data: insertedDoc, error: dbError } = await supabase
        .from('documents').insert({
          tenant_id: profile.tenant_id,
          pipeline_entry_id: pipelineEntryId,
          document_type: documentType,
          filename: `${sanitizedLabel}.pdf`,
          file_path: fileName,
          file_size: pdfBlob.size,
          mime_type: 'application/pdf',
          uploaded_by: user.id,
          description: `Scanned ${capturedPages.length}-page ${documentLabel}`,
          page_count: capturedPages.length,
          scan_source: capturedPages.every(p => p.captureMethod === 'imported_pdf_rebuilt') ? 'imported_pdf' : 'camera',
          metadata: scanMetadata,
          scan_quality: scanQuality,
          ocr_status: 'processing',
        } as any).select('id').single();
      if (dbError) throw dbError;

      if (insertedDoc?.id) {
        supabase.functions.invoke('ocr-scanned-document', { body: { document_id: insertedDoc.id } })
          .catch(e => console.warn('[scanner] OCR invoke failed:', e));
      }
      setUploadProgress(100);
      toast({ title: 'PDF Created', description: `${capturedPages.length}-page PDF uploaded.` });

      capturedPages.forEach(p => URL.revokeObjectURL(p.preview));
      setCapturedPages([]);
      // Clear persisted scan session once the upload succeeds.
      clearScanSession(pipelineEntryId, documentType).catch(() => {});
      onOpenChange(false);
      onUploadComplete?.();
    } catch (err: any) {
      console.error('PDF generation error:', err);
      toast({ title: 'Upload Failed', description: err.message || 'Failed to create PDF.', variant: 'destructive' });
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
      setShowQA(false);
    }
  };

  const handleClose = () => {
    if (capturedPages.length > 0 && !isUploading) {
      const proceed = confirm(
        `Keep ${capturedPages.length} captured page${capturedPages.length > 1 ? 's' : ''} for next time? ` +
        `Click OK to keep, Cancel to discard.`
      );
      if (!proceed) {
        clearScanSession(pipelineEntryId, documentType).catch(() => {});
      }
    }
    onOpenChange(false);
  };

  // QA-screen entry point bound to the Upload button.
  const openQAReview = () => {
    if (capturedPages.length === 0) {
      toast({ title: 'No Pages', description: 'Capture at least one page.', variant: 'destructive' });
      return;
    }
    setShowQA(true);
  };

  // Per-page override of page size (used from QA screen)
  const setPageSizeOverride = (index: number, size: DetectedPageSize) => {
    setCapturedPages(prev => {
      const next = [...prev];
      if (!next[index]) return prev;
      next[index] = { ...next[index], pageSizeOverride: size === 'unknown' ? null : size, pageSize: size === 'unknown' ? next[index].pageSize : size };
      return next;
    });
  };

  const copyScannerDiagnostics = async () => {
    const diagnostics = {
      scanner_version: SCANNER_VERSION,
      scanner_session_id: scannerSessionIdRef.current,
      browser: navigator.userAgent,
      opencv_ready: opencvReady,
      opencv_failed: opencvFailed,
      detector_engine: opencvReady ? 'opencv' : 'fallback',
      scan_preset: scanPreset,
      pdf_profile: pdfProfile,
      auto_capture: autoCapture,
      video_dimensions: { w: videoWidth, h: videoHeight },
      torch_supported: torchSupported,
      page_count: capturedPages.length,
      per_page: capturedPages.map((p, i) => ({
        index: i,
        capture_method: p.captureMethod,
        source: { w: p.sourceWidth, h: p.sourceHeight },
        output: { w: p.outputWidth, h: p.outputHeight },
        page_size: p.pageSize,
        page_size_override: p.pageSizeOverride ?? null,
        confidence: p.confidence,
        deskew_angle: p.deskewAngle,
        crop_mode: p.cropMode,
        color_mode: p.colorMode,
        shadow_severity: p.shadowSeverity,
        blur_overridden: p.blurOverridden,
        duplicate_warning: !!p.duplicateWarning,
        edge_cleanup_applied: !!p.edgeCleanupApplied,
        // Intentionally omitting image data and OCR/customer text.
      })),
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2));
      toast({ title: 'Diagnostics copied', description: 'Scanner JSON copied to clipboard.' });
    } catch {
      toast({ title: 'Copy failed', description: 'Clipboard unavailable.', variant: 'destructive' });
    }
  };


  const handleForceManualCrop = useCallback(async () => {
    if (!videoRef.current || !cameraReady) return;
    const hi = await captureHighResFrame(videoRef.current, streamRef.current);
    setPendingCaptureCanvas(hi.canvas);
    setPendingCaptureMeta({ method: hi.method, sourceWidth: hi.sourceWidth, sourceHeight: hi.sourceHeight });
    hi.canvas.toBlob((blob) => {
      if (blob) {
        setManualCropImage({ url: URL.createObjectURL(blob), width: hi.canvas.width, height: hi.canvas.height });
        setShowManualCrop(true);
      }
    }, 'image/jpeg', 0.9);
  }, [cameraReady]);

  const handleToggleTorch = useCallback(async () => {
    if (!streamRef.current || !torchSupported) return;
    const next = !torchOn;
    const ok = await setTorch(streamRef.current, next);
    if (ok) setTorchOn(next);
  }, [torchOn, torchSupported]);

  const bottomPadding = hasHomeIndicator() ? 'pb-8' : 'pb-4';
  const isStable = stabilityResult?.stable ?? false;
  const qualityBlocked = qualityGate?.block ?? false;
  const qualityLevel = qualityGate?.level ?? 'ok';
  const readyToCapture = isStable && !qualityBlocked;
  const scannerStatusLabel = opencvReady
    ? 'Scanner ready'
    : opencvLoading ? 'Loading scanner engine…'
    : opencvFailed ? 'Using fallback scanner'
    : 'Initializing…';

  // Manual crop overlay
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

  // Full-page preview
  const previewPage = previewIndex !== null ? capturedPages[previewIndex] : null;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className={cn(
          'max-w-full h-[100dvh] sm:max-w-2xl sm:h-auto sm:max-h-[95vh] p-0 gap-0',
          'flex flex-col bg-background',
        )}
      >
        <DialogHeader className="px-4 py-3 border-b flex-shrink-0">
          <div className="flex items-center justify-between gap-2">
            <DialogTitle className="text-lg font-semibold flex items-center gap-2 truncate">
              📄 Scan {documentLabel}
              {capturedPages.length > 0 && (
                <span className="text-sm font-normal text-muted-foreground">
                  • {capturedPages.length} page{capturedPages.length > 1 ? 's' : ''}
                </span>
              )}
              {retakeIndex !== null && (
                <span className="text-xs font-medium text-warning ml-2">
                  Retake page {retakeIndex + 1}
                </span>
              )}
            </DialogTitle>
            <Button variant="ghost" size="icon" onClick={handleClose} disabled={isUploading} className="h-8 w-8">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>

        {/* Top controls */}
        <div className="flex-shrink-0 px-3 py-2 border-b grid grid-cols-2 gap-2 bg-muted/20">
          <div>
            <Label className="text-xs text-muted-foreground">Scan Mode</Label>
            <Select value={scanPreset} onValueChange={(v) => setScanPreset(v as ScanPreset)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.values(SCAN_PRESETS).map(p => (
                  <SelectItem key={p.preset} value={p.preset}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">PDF Quality</Label>
            <Select value={pdfProfile} onValueChange={(v) => setPdfProfile(v as PdfProfile)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.values(PDF_PROFILES).map(p => (
                  <SelectItem key={p.profile} value={p.profile}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex-shrink-0 px-3 py-1.5 border-b flex flex-wrap items-center gap-x-4 gap-y-1 text-xs bg-muted/10">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <Switch checked={autoCapture} onCheckedChange={setAutoCapture} className="scale-75" />
            Auto-capture
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <Switch checked={burnPageNumbers} onCheckedChange={setBurnPageNumbers} className="scale-75" />
            Burn page #
          </label>
          {isDev && (
            <label className="flex items-center gap-1.5 cursor-pointer ml-auto">
              <Switch checked={showDiagnostics} onCheckedChange={setShowDiagnostics} className="scale-75" />
              <Bug className="h-3 w-3" /> Diag
            </label>
          )}
        </div>

        {/* Camera Preview */}
        <div className="flex-1 relative bg-black min-h-0 overflow-hidden">
          {cameraError ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-white p-4 text-center">
              <Camera className="h-12 w-12 mb-4 opacity-50" />
              <p className="text-lg mb-2">Camera Error</p>
              <p className="text-sm opacity-75 mb-4">{cameraError}</p>
              <Button variant="outline" onClick={startCamera}>
                <RotateCcw className="h-4 w-4 mr-2" /> Try Again
              </Button>
            </div>
          ) : (
            <>
              <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
              {!cameraReady && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                  <Loader2 className="h-8 w-8 animate-spin text-white" />
                </div>
              )}

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
                    fill={isStable ? 'hsla(142, 76%, 36%, 0.2)' : 'hsla(45, 93%, 47%, 0.15)'}
                    stroke={isStable ? 'hsl(142, 76%, 36%)' : 'hsl(45, 93%, 47%)'}
                    strokeWidth="4"
                    className="transition-all duration-300"
                  />
                  {[detectedCorners.topLeft, detectedCorners.topRight, detectedCorners.bottomRight, detectedCorners.bottomLeft].map((c, i) => (
                    <circle key={i} cx={c.x} cy={c.y} r="12"
                      fill={isStable ? 'hsl(142, 76%, 36%)' : 'hsl(45, 93%, 47%)'}
                      stroke="hsl(0, 0%, 100%)" strokeWidth="2" />
                  ))}
                </svg>
              )}

              {cameraReady && !detectedCorners && (
                <div className="absolute inset-4 border-2 border-white/30 rounded-lg pointer-events-none">
                  <div className="absolute top-2 left-2 w-6 h-6 border-t-2 border-l-2 border-white rounded-tl" />
                  <div className="absolute top-2 right-2 w-6 h-6 border-t-2 border-r-2 border-white rounded-tr" />
                  <div className="absolute bottom-2 left-2 w-6 h-6 border-b-2 border-l-2 border-white rounded-bl" />
                  <div className="absolute bottom-2 right-2 w-6 h-6 border-b-2 border-r-2 border-white rounded-br" />
                </div>
              )}

              {cameraReady && (
                <div className={cn(
                  'absolute top-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full text-sm font-medium shadow-lg transition-all duration-300 max-w-[90%] text-center',
                  qualityLevel === 'block' ? 'bg-destructive text-destructive-foreground'
                    : qualityLevel === 'warn' ? 'bg-warning text-warning-foreground'
                    : readyToCapture ? 'bg-success text-success-foreground'
                    : detectedCorners ? 'bg-warning text-warning-foreground'
                    : 'bg-muted text-muted-foreground',
                )}>
                  {autoCountdown !== null && autoCountdown > 0 && autoCapture
                    ? `Capturing in ${autoCountdown}…`
                    : qualityGate?.message
                      ? qualityGate.message
                      : readyToCapture
                        ? '✓ Ready to Capture'
                        : detectedCorners
                          ? 'Hold steady…'
                          : 'Position document in frame'}
                </div>
              )}

              {cameraReady && (
                <div className="absolute top-14 left-1/2 -translate-x-1/2 flex flex-wrap gap-2 justify-center max-w-[90%]">
                  <span className={cn(
                    'px-3 py-1 rounded-full text-xs',
                    opencvReady ? 'bg-success/80 text-success-foreground'
                      : opencvFailed ? 'bg-warning/80 text-warning-foreground'
                      : 'bg-primary/80 text-primary-foreground'
                  )}>{scannerStatusLabel}</span>
                  {detectedCorners?.pageSize && detectedCorners.pageSize !== 'unknown' && (
                    <span className="px-3 py-1 rounded-full text-xs bg-black/60 text-white uppercase">
                      {detectedCorners.pageSize}
                    </span>
                  )}
                  <span className="px-3 py-1 rounded-full text-xs bg-black/60 text-white">
                    {SCAN_PRESETS[scanPreset].label}
                  </span>
                </div>
              )}

              {/* Diagnostics panel (dev) */}
              {cameraReady && showDiagnostics && (
                <div className="absolute bottom-4 left-4 right-4 sm:right-auto sm:max-w-xs bg-black/80 text-white text-[10px] font-mono p-2 rounded space-y-0.5">
                  <div>engine: {opencvReady ? 'opencv' : 'fallback'}</div>
                  <div>confidence: {detectedCorners?.confidence?.toFixed(2) ?? '—'}</div>
                  <div>stable: {String(isStable)} (jitter {stabilityResult?.jitterScore?.toFixed(1) ?? '—'})</div>
                  <div>pageSize: {detectedCorners?.pageSize ?? '—'}</div>
                  <div>glare%: {((qualityGate?.flags.overexposed_ratio ?? 0) * 100).toFixed(1)}</div>
                  <div>shadow%: {((qualityGate?.flags.underexposed_ratio ?? 0) * 100).toFixed(1)}</div>
                  <div>blur: {qualityGate?.flags.blur_score?.toFixed(1) ?? '—'}</div>
                  <div>mean: {qualityGate?.flags.mean_brightness?.toFixed(0) ?? '—'}</div>
                  <div>video: {videoWidth}×{videoHeight}</div>
                </div>
              )}

              {cameraReady && torchSupported && (
                <button
                  type="button"
                  onClick={handleToggleTorch}
                  aria-label={torchOn ? 'Turn torch off' : 'Turn torch on'}
                  className={cn(
                    'absolute top-4 right-4 h-10 w-10 rounded-full flex items-center justify-center shadow-lg',
                    torchOn ? 'bg-warning text-warning-foreground' : 'bg-black/60 text-white',
                  )}
                >
                  {torchOn ? <Zap className="h-5 w-5" /> : <ZapOff className="h-5 w-5" />}
                </button>
              )}

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

        {/* Thumbnails */}
        {capturedPages.length > 0 && (
          <div className="flex-shrink-0 border-t bg-muted/50 p-2 overflow-x-auto">
            <div className="flex gap-2 min-w-min">
              {capturedPages.map((page, index) => (
                <div
                  key={`${index}-${page.preview}`}
                  className={cn(
                    'relative group flex-shrink-0 w-20 h-24 rounded-md overflow-hidden border-2',
                    retakeIndex === index ? 'border-warning ring-2 ring-warning/50' : 'border-border',
                  )}
                >
                  <img src={page.preview} alt={`Page ${index + 1}`} className="w-full h-full object-cover cursor-pointer"
                    onClick={() => setPreviewIndex(index)} />
                  <div className="absolute top-0 left-0 bg-black/60 text-white text-xs px-1.5 py-0.5 rounded-br">
                    {index + 1}
                  </div>
                  <div className="absolute bottom-0 inset-x-0 flex justify-between bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => movePage(index, -1)} disabled={isUploading || index === 0}
                      className="p-1 text-white disabled:opacity-30" aria-label="Move left">
                      <ArrowLeft className="h-3 w-3" />
                    </button>
                    <button onClick={() => setPreviewIndex(index)} className="p-1 text-white" aria-label="Preview">
                      <Eye className="h-3 w-3" />
                    </button>
                    <button onClick={() => movePage(index, 1)} disabled={isUploading || index === capturedPages.length - 1}
                      className="p-1 text-white disabled:opacity-30" aria-label="Move right">
                      <ArrowRight className="h-3 w-3" />
                    </button>
                  </div>
                  <button onClick={() => removePage(index)} disabled={isUploading}
                    className="absolute top-0 right-0 p-1 bg-destructive text-destructive-foreground rounded-bl opacity-0 group-hover:opacity-100 transition-opacity"
                    aria-label="Delete page">
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Page preview drawer */}
        {previewPage && previewIndex !== null && (
          <div className="absolute inset-0 z-50 bg-black/90 flex flex-col" onClick={() => setPreviewIndex(null)}>
            <div className="flex-1 flex items-center justify-center p-4" onClick={(e) => e.stopPropagation()}>
              <img src={previewPage.preview} alt={`Page ${previewIndex + 1}`} className="max-w-full max-h-full object-contain" />
            </div>
            <div className="flex-shrink-0 bg-background border-t flex flex-wrap gap-2 p-3 justify-center" onClick={(e) => e.stopPropagation()}>
              <Button size="sm" variant="outline" onClick={() => rotatePage(previewIndex, -90)}>
                <RotateCcw className="h-4 w-4 mr-1" /> Rotate L
              </Button>
              <Button size="sm" variant="outline" onClick={() => rotatePage(previewIndex, 90)}>
                <RotateCw className="h-4 w-4 mr-1" /> Rotate R
              </Button>
              <Button size="sm" variant="outline" onClick={() => rotatePage(previewIndex, 180)}>
                180°
              </Button>
              <Button size="sm" variant="outline" onClick={() => { startRetake(previewIndex); setPreviewIndex(null); }}>
                <Camera className="h-4 w-4 mr-1" /> Retake
              </Button>
              <Button size="sm" variant="destructive" onClick={() => { removePage(previewIndex); setPreviewIndex(null); }}>
                <Trash2 className="h-4 w-4 mr-1" /> Delete
              </Button>
              <Button size="sm" onClick={() => setPreviewIndex(null)}>Done</Button>
            </div>
          </div>
        )}

        {/* Import + manual-crop row */}
        <div className="flex-shrink-0 flex gap-2 px-4 py-2 border-t bg-muted/30">
          <input ref={photoInputRef} type="file" accept="image/*" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleImportPhoto(f); e.currentTarget.value = ''; }} />
          <input ref={pdfInputRef} type="file" accept="application/pdf" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) setImportPdfChoice(f); e.currentTarget.value = ''; }} />
          <Button variant="outline" size="sm" onClick={() => photoInputRef.current?.click()}
            disabled={isUploading || isProcessing} className="flex-1">
            <Upload className="h-4 w-4 mr-1" /> Import Photo
          </Button>
          <Button variant="outline" size="sm" onClick={() => pdfInputRef.current?.click()}
            disabled={isUploading || isProcessing} className="flex-1">
            <FileUp className="h-4 w-4 mr-1" /> Import PDF
          </Button>
          <Button variant="outline" size="sm" onClick={handleForceManualCrop}
            disabled={!cameraReady || isUploading || isProcessing} title="Manually adjust corners">
            <Edit2 className="h-4 w-4" />
          </Button>
        </div>

        {isUploading && (
          <div className="flex-shrink-0 px-4 py-2 border-t bg-muted/30">
            <div className="flex items-center gap-3">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <div className="flex-1"><Progress value={uploadProgress} className="h-2" /></div>
              <span className="text-sm text-muted-foreground">{Math.round(uploadProgress)}%</span>
            </div>
          </div>
        )}

        <div className={cn(
          'flex-shrink-0 flex items-center justify-between gap-3 px-4 py-3 border-t bg-background',
          bottomPadding,
        )}>
          <Button variant="outline" onClick={handleClose} disabled={isUploading || isProcessing} className="flex-1 sm:flex-none">
            Cancel
          </Button>
          <button
            onClick={captureAndProcess}
            disabled={!cameraReady || isUploading || isProcessing}
            className={cn(
              'w-16 h-16 sm:w-14 sm:h-14 rounded-full bg-primary hover:bg-primary/90 active:scale-95',
              'flex items-center justify-center transition-all duration-150',
              'disabled:opacity-50 disabled:cursor-not-allowed border-4 border-primary-foreground shadow-lg',
              readyToCapture && 'ring-4 ring-success/50 animate-pulse',
            )}
            aria-label="Capture page"
          >
            {isProcessing
              ? <Loader2 className="h-6 w-6 text-primary-foreground animate-spin" />
              : <Camera className="h-6 w-6 text-primary-foreground" />}
          </button>
          <Button
            onClick={openQAReview}
            disabled={capturedPages.length === 0 || isUploading || isProcessing}
            className="flex-1 sm:flex-none gradient-primary"
          >
            {isUploading
              ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Uploading...</>
              : <><ClipboardCheck className="h-4 w-4 mr-1" />Review ({capturedPages.length})</>}
          </Button>
        </div>

        {/* Resume-prompt overlay */}
        {resumePromptSession && (
          <div className="absolute inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
            <div className="bg-background rounded-lg p-5 max-w-sm w-full space-y-3 shadow-2xl">
              <div className="font-semibold">Resume unfinished scan?</div>
              <p className="text-sm text-muted-foreground">
                We saved {resumePromptSession.pages} page{resumePromptSession.pages === 1 ? '' : 's'} from
                a previous session ({new Date(resumePromptSession.updatedAt).toLocaleString()}).
              </p>
              <div className="flex gap-2 justify-end">
                <Button variant="ghost" size="sm" onClick={async () => {
                  await clearScanSession(pipelineEntryId, documentType);
                  setResumePromptSession(null);
                  setPendingResumePages(null);
                }}>Discard</Button>
                <Button size="sm" onClick={async () => {
                  if (pendingResumePages) {
                    const restored: CapturedPage[] = pendingResumePages.map((p) => ({
                      blob: p.blob,
                      preview: URL.createObjectURL(p.blob),
                      cropMode: p.cropMode,
                      colorMode: p.colorMode,
                      preset: p.preset as ScanPreset,
                      confidence: p.confidence,
                      pageSize: p.pageSize as DetectedPageSize,
                      pageSizeOverride: (p.pageSizeOverride ?? null) as DetectedPageSize | null,
                      deskewAngle: p.deskewAngle,
                      quality: p.quality ?? null,
                      captureMethod: p.captureMethod as CaptureMethod,
                      sourceWidth: p.sourceWidth,
                      sourceHeight: p.sourceHeight,
                      outputWidth: p.outputWidth,
                      outputHeight: p.outputHeight,
                      shadowSeverity: p.shadowSeverity as ShadowSeverity,
                      blurOverridden: p.blurOverridden,
                      rotationApplied: p.rotationApplied,
                      imageHash: p.imageHash,
                      edgeCleanupApplied: p.edgeCleanupApplied,
                      duplicateWarning: p.duplicateWarning,
                    }));
                    setCapturedPages(restored);
                  }
                  setResumePromptSession(null);
                  setPendingResumePages(null);
                }}>Resume</Button>
              </div>
            </div>
          </div>
        )}

        {/* Imported PDF choice */}
        {importPdfChoice && (
          <div className="absolute inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
            <div className="bg-background rounded-lg p-5 max-w-sm w-full space-y-3 shadow-2xl">
              <div className="font-semibold">Import PDF</div>
              <p className="text-sm text-muted-foreground">
                {importPdfChoice.name} ({(importPdfChoice.size / 1024 / 1024).toFixed(1)} MB).
                Upload as-is, or rebuild it through the scanner pipeline for cleaner pages.
              </p>
              <div className="grid grid-cols-1 gap-2">
                <Button variant="outline" size="sm" onClick={async () => {
                  const f = importPdfChoice;
                  setImportPdfChoice(null);
                  await handleImportPdf(f);
                }}>Upload Original</Button>
                <Button variant="outline" size="sm" onClick={async () => {
                  const f = importPdfChoice;
                  setImportPdfChoice(null);
                  await handleImportPdfRebuild(f);
                }}>Clean / Rebuild PDF</Button>
                <Button variant="ghost" size="sm" onClick={() => setImportPdfChoice(null)}>Cancel</Button>
              </div>
            </div>
          </div>
        )}

        {/* Final QA review overlay */}
        {showQA && (
          <div className="absolute inset-0 z-40 bg-background flex flex-col">
            <ScannerQAReview
              pages={capturedPages.map(p => ({
                preview: p.preview,
                pageSize: p.pageSize,
                pageSizeOverride: p.pageSizeOverride ?? null,
                colorMode: p.colorMode,
                cropMode: p.cropMode,
                blurOverridden: p.blurOverridden,
                shadowSeverity: p.shadowSeverity,
                duplicateWarning: p.duplicateWarning,
                quality: p.quality,
                edgeCleanupApplied: p.edgeCleanupApplied,
              }))}
              pdfProfile={pdfProfile}
              onBack={() => setShowQA(false)}
              onUpload={(ack) => handleBatchUpload(ack)}
              onPreview={(i) => { setShowQA(false); setPreviewIndex(i); }}
              onRetake={(i) => { setShowQA(false); startRetake(i); }}
              onDelete={(i) => removePage(i)}
              onRotate={(i, deg) => rotatePage(i, deg)}
              onMove={(i, d) => movePage(i, d)}
              onChangePageSize={(i, sz) => setPageSizeOverride(i, sz)}
              onCopyDiagnostics={copyScannerDiagnostics}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
