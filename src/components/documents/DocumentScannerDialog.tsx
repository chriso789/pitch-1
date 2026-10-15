import { recordLinkColumns, type ScanRecordType } from '@/lib/scan-records/recordLink';
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
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { makeScanSearchable, type ScanOcrSummary } from '@/lib/scan-ocr/scanSearchable';
import { detectDocumentEdges, DetectedCorners } from '@/utils/documentEdgeDetection';
import {
  detectDocumentEdgesOpenCV, loadOpenCV, isOpenCVAvailable, DetectedCornersExt,
} from '@/utils/documentEdgeDetectionOpenCV';
import { CornerStabilityBuffer, validateQuadrilateral, StabilityResult } from '@/utils/documentStability';
import { applyPerspectiveTransformPro } from '@/utils/documentEnhancementPro';
import { restoreScan, checkInkPreservation, estimatePaper, SCAN_MODES, DEFAULT_RESTORE_OPTIONS, type ScanMode } from '@/lib/scan-restore/restore';
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
import { getOrCreateUploadId, clearUploadId, scanUploadPaths, SCAN_UPLOAD_STATUS_LABEL, type ScanUploadStatus } from '@/lib/scan-records/uploadIdentity';
import { renderImportedPdf, getPdfjsDiagnostics } from '@/utils/scannerPdfImport';
import { ScannerTelemetry } from '@/utils/scannerTelemetry';
import { ObjectUrlRegistry, detectDeviceMemoryProfile, downscaleCanvasInPlace } from '@/utils/scannerMobileGuards';
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
  /** Cleanup mode used for this page (UltraScan). */
  scanMode?: ScanMode;
  /** Untouched camera frame, uploaded alongside the PDF and never altered. */
  originalBlob?: Blob;
  /** Cropped/straightened page before cleanup, shown as "Before" in review. */
  beforePreview?: string;
  /** Cleanup erased a meaningful share of ink: user must review before saving. */
  inkReview?: boolean;
  inkLossRatio?: number;
  /** Crop corners in original-image pixels, so the page can be re-edited later. */
  corners?: DetectedCornersExt;
  /** Current post-capture settings, always applied to `originalBlob`. */
  edit?: PageEdit;
  /** Previous settings for Undo. */
  editHistory?: PageEdit[];
}

interface PageEdit {
  mode: ScanMode;
  intensity: number;
  brightness: number;
  contrast: number;
  corners: DetectedCornersExt;
}

const SCANNER_VERSION = '2.4.0';
const HOLD_STILL_MS = 350;
const AUTOCAPTURE_HOLD_MS = 1000;
const AUTOCAPTURE_COOLDOWN_MS = 1500;

interface DocumentScannerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  documentType: string;
  documentLabel: string;
  /** Lead (pipeline entry) when scanning from a lead; optional for other records. */
  pipelineEntryId?: string;
  /** Record the scan belongs to (lead, contact, job, commercial project, permit, contract…). Defaults to the pipeline entry. */
  recordType?: ScanRecordType;
  recordId?: string;
  /** Optional document name / category chosen by the user. */
  documentName?: string;
  documentCategory?: string;
  onUploadComplete?: () => void;
}

export function DocumentScannerDialog({
  open,
  onOpenChange,
  documentType,
  documentLabel,
  pipelineEntryId,
  recordType = 'pipeline_entry',
  recordId,
  documentName,
  documentCategory,
  onUploadComplete,
}: DocumentScannerDialogProps) {
  const sessionKey = recordId ?? pipelineEntryId ?? 'unlinked';
  const effectiveTenantId = useEffectiveTenantId();
  const [searchablePdf, setSearchablePdf] = useState(true);
  const [ocrSpanish, setOcrSpanish] = useState(true);
  // Core capture state
  const [capturedPages, setCapturedPages] = useState<CapturedPage[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<ScanUploadStatus>('saved_on_device');
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
  const [scanMode, setScanMode] = useState<ScanMode>(SCAN_PRESETS[DEFAULT_SCAN_PRESET].colorMode === 'bw' ? 'bw' : 'auto');
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
  // Source-file metadata for imported PDFs that get rebuilt through the scanner.
  const importedPdfSourceRef = useRef<{ name: string; size: number; pageCount: number } | null>(null);

  // Preload OpenCV
  useEffect(() => {
    if (isOpenCVAvailable()) { setOpencvReady(true); return; }
    const kick = () => {
      setOpencvLoading(true);
      opencvStartTsRef.current = performance.now();
      loadOpenCV()
        .then((ok) => {
          setOpencvReady(!!ok);
          setOpencvFailed(!ok);
          if (ok && opencvStartTsRef.current) {
            telemetryRef.current.mark('opencvLoadMs', performance.now() - opencvStartTsRef.current);
          }
        })
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

  // Camera lifecycle + resume check + production hardening setup
  useEffect(() => {
    if (open) {
      // Fresh telemetry + URL registry per session
      telemetryRef.current = new ScannerTelemetry();
      urlRegRef.current = new ObjectUrlRegistry();
      autosaveEnabledRef.current = true;
      autosaveDisabledReasonRef.current = null;
      autosaveBytesRef.current = 0;
      setAutosaveEnabled(true);
      userPickedProfileRef.current = false;
      // Re-detect device profile (orientation/PWA can change between opens)
      deviceProfileRef.current = detectDeviceMemoryProfile();
      // Low-memory: default PDF profile to Standard unless user already picked one
      if (deviceProfileRef.current.isLowMemory && !userPickedProfileRef.current) {
        setPdfProfile('standard');
      }
      // Purge expired sessions (24h TTL) on every open
      purgeExpiredScanSessions(DEFAULT_SESSION_TTL_MS).catch(() => {});

      cameraStartTsRef.current = performance.now();
      startCamera();
      stabilityBufferRef.current.reset();
      autoStableSinceRef.current = null;
      scannerSessionIdRef.current = makeScannerSessionId();
      // Check for unfinished session
      loadScanSession(sessionKey, documentType).then((existing) => {
        if (existing && existing.pages.length > 0) {
          setResumePromptSession({ pages: existing.pages.length, updatedAt: existing.updatedAt });
          setPendingResumePages(existing.pages);
          if (existing.scannerSessionId) scannerSessionIdRef.current = existing.scannerSessionId;
        }
      });
    } else {
      stopCamera();
      // Revoke every URL we minted this session (registry owns all preview URLs).
      urlRegRef.current.revokeAll();
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
      setSettingsOpen(false);
      importedPdfSourceRef.current = null;
    }
    return () => {
      stopCamera();
      urlRegRef.current.revokeAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Autosave: every time pages change, persist to IndexedDB (respects quota)
  useEffect(() => {
    if (!open || capturedPages.length === 0) return;
    if (!autosaveEnabledRef.current) return;
    const t = setTimeout(async () => {
      const res = await saveScanSession({
        id: `${sessionKey}::${documentType}`,
        scannerSessionId: scannerSessionIdRef.current,
        pipelineEntryId: sessionKey,
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
      if (res.ok) {
        autosaveBytesRef.current = res.bytesAfter;
      } else if (res.reason === 'quota_exceeded') {
        autosaveEnabledRef.current = false;
        autosaveDisabledReasonRef.current = 'quota_exceeded';
        setAutosaveEnabled(false);
        toast({
          title: 'Local scan recovery is full',
          description: 'Your scan can continue, but recovery is disabled for new pages. Clear saved sessions in scanner settings to re-enable.',
        });
      } else {
        autosaveEnabledRef.current = false;
        autosaveDisabledReasonRef.current = 'error';
        setAutosaveEnabled(false);
      }
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
        videoRef.current.onloadedmetadata = () => {
          setCameraReady(true);
          if (cameraStartTsRef.current) {
            telemetryRef.current.mark('cameraStartupMs', performance.now() - cameraStartTsRef.current);
          }
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
      // UltraScan: crop/straighten only, then clean up with the chosen mode and
      // check that no ink (signatures, initials, faint pen) was erased.
      let enhanced = applyPerspectiveTransformPro(sourceCanvas, corners, spec.outputWidth, spec.outputHeight);
      const wctx = enhanced.getContext('2d')!;
      const warped = wctx.getImageData(0, 0, enhanced.width, enhanced.height);
      const warpedImg = { data: warped.data, width: warped.width, height: warped.height };
      const beforeBlob: Blob | null = await new Promise((r) => enhanced.toBlob((b) => r(b), 'image/jpeg', 0.8));
      let inkReview = false, inkLossRatio = 0;
      if (scanMode !== 'original') {
        const paper = estimatePaper(warpedImg);
        const cleaned = restoreScan(warpedImg, scanMode);
        const ink = checkInkPreservation(warpedImg, cleaned, paper);
        inkReview = ink.needsReview; inkLossRatio = ink.lossRatio;
        wctx.putImageData(new ImageData(cleaned.data as Uint8ClampedArray<ArrayBuffer>, cleaned.width, cleaned.height), 0, 0);
      }
      const originalBlob: Blob | null = await new Promise((r) => sourceCanvas.toBlob((b) => r(b), 'image/jpeg', 0.95));

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
      // Low-memory devices: generate a downscaled preview blob so the thumbnail
      // grid never pins multiple full-res JPEGs in memory. The original `blob`
      // (full-res) is still what we store and use to build the final PDF.
      let previewBlob: Blob = blob;
      if (deviceProfileRef.current.isLowMemory) {
        try {
          const preCanvas = downscaleCanvasInPlace(enhanced, deviceProfileRef.current.previewMaxEdgePx);
          previewBlob = await new Promise<Blob>((resolve) =>
            preCanvas.toBlob((b) => resolve(b ?? blob), 'image/jpeg', 0.8),
          );
        } catch { /* fall back to full-res preview */ }
      }
      const preview = urlRegRef.current.create(previewBlob);

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
            urlRegRef.current.revoke(preview);
            return false;
          }
        }
      }

      const newPage: CapturedPage = {
        blob,
        preview,
        cropMode,
        colorMode: scanMode === 'bw' ? 'bw' : 'color',
        preset: scanPreset,
        scanMode,
        originalBlob: originalBlob ?? undefined,
        beforePreview: beforeBlob ? urlRegRef.current.create(beforeBlob) : undefined,
        inkReview,
        inkLossRatio,
        corners,
        edit: { mode: scanMode, ...DEFAULT_RESTORE_OPTIONS, corners },
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
          urlRegRef.current.revoke(prev[retakeIndex].preview);
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
  }, [capturedPages, scanPreset, scanMode, burnPageNumbers, retakeIndex]);

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
              url: urlRegRef.current.create(blob),
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
      if (manualCropImage) urlRegRef.current.revoke(manualCropImage.url);
      setManualCropImage(null);
      setPendingCaptureCanvas(null);
      setPendingCaptureMeta(null);
    }
  }, [pendingCaptureCanvas, pendingCaptureMeta, processAndAddPage, manualCropImage, qualityGate]);

  const handleManualCropCancel = useCallback(() => {
    setShowManualCrop(false);
    if (manualCropImage) urlRegRef.current.revoke(manualCropImage.url);
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
      urlRegRef.current.revoke(next[index].preview);
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
      const preview = urlRegRef.current.create(rotated);
      urlRegRef.current.revoke(page.preview);
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

  // --------------------------------------------------------------------------
  // Post-capture editing: always rebuilt from the untouched camera image.
  // --------------------------------------------------------------------------
  const [editBusy, setEditBusy] = useState(false);
  const [showBefore, setShowBefore] = useState(false);
  const [recrop, setRecrop] = useState<{ index: number; url: string; width: number; height: number } | null>(null);

  const renderEdit = async (page: CapturedPage, e: PageEdit) => {
    if (!page.originalBlob) throw new Error('This page has no original photo to re-edit. Retake it instead.');
    const bmp = await createImageBitmap(page.originalBlob);
    const src = document.createElement('canvas');
    src.width = bmp.width; src.height = bmp.height;
    src.getContext('2d')!.drawImage(bmp, 0, 0); bmp.close?.();
    const spec = getPageSpec(page.pageSizeOverride ?? page.pageSize);
    let c = applyPerspectiveTransformPro(src, e.corners, spec.outputWidth, spec.outputHeight);
    const ctx = c.getContext('2d')!;
    const w = ctx.getImageData(0, 0, c.width, c.height);
    const img = { data: w.data, width: w.width, height: w.height };
    const beforeBlob: Blob | null = await new Promise((r) => c.toBlob((b) => r(b), 'image/jpeg', 0.8));
    const cleaned = restoreScan(img, e.mode, e);
    const ink = e.mode === 'original' && e.brightness === 0 && e.contrast === 1
      ? { needsReview: false, lossRatio: 0 }
      : checkInkPreservation(img, cleaned, estimatePaper(img));
    ctx.putImageData(new ImageData(cleaned.data as Uint8ClampedArray<ArrayBuffer>, cleaned.width, cleaned.height), 0, 0);
    const { canvas: desk, angle } = deskewCanvas(c); c = desk;
    let blob: Blob = await new Promise((r, j) => c.toBlob((b) => (b ? r(b) : j(new Error('encode failed'))), 'image/jpeg', 0.95));
    const rot = page.rotationApplied;
    if (rot) blob = await rotateBlob(blob, rot === 270 ? -90 : (rot as 90 | 180));
    const swap = rot === 90 || rot === 270;
    return { blob, beforeBlob, ink, angle, outW: swap ? c.height : c.width, outH: swap ? c.width : c.height };
  };

  const applyEdit = async (indices: number[], patch: Partial<PageEdit>, opts: { undo?: boolean } = {}) => {
    setEditBusy(true);
    try {
      const results = await Promise.all(indices.map(async (i) => {
        const page = capturedPages[i];
        if (!page?.edit) return null;
        let e: PageEdit, history = page.editHistory ?? [];
        if (opts.undo) { if (!history.length) return null; e = history[history.length - 1]; history = history.slice(0, -1); }
        else { e = { ...page.edit, ...patch }; history = [...history, page.edit].slice(-20); }
        const r = await renderEdit(page, e);
        return { i, e, history, r };
      }));
      setCapturedPages((prev) => {
        const next = [...prev];
        for (const x of results) {
          if (!x || !next[x.i]) continue;
          const old = next[x.i];
          urlRegRef.current.revoke(old.preview);
          if (old.beforePreview) urlRegRef.current.revoke(old.beforePreview);
          next[x.i] = {
            ...old, blob: x.r.blob, preview: urlRegRef.current.create(x.r.blob),
            beforePreview: x.r.beforeBlob ? urlRegRef.current.create(x.r.beforeBlob) : undefined,
            scanMode: x.e.mode, colorMode: x.e.mode === 'bw' ? 'bw' : 'color',
            inkReview: x.r.ink.needsReview, inkLossRatio: x.r.ink.lossRatio,
            deskewAngle: x.r.angle, outputWidth: x.r.outW, outputHeight: x.r.outH,
            corners: x.e.corners, edit: x.e, editHistory: x.history, edgeCleanupApplied: false,
          };
        }
        return next;
      });
      const flagged = results.filter((x) => x?.r.ink.needsReview).length;
      if (flagged) toast({ title: 'Check the ink', description: `${flagged} page(s) may have lost handwriting or signatures. Compare Before/After or lower the cleanup.`, variant: 'destructive' });
    } catch (err: any) {
      toast({ title: 'Could not re-edit page', description: err.message, variant: 'destructive' });
    } finally { setEditBusy(false); }
  };

  const openRecrop = async (index: number) => {
    const page = capturedPages[index];
    if (!page?.originalBlob) { toast({ title: 'No original photo', description: 'Retake this page to change its crop.', variant: 'destructive' }); return; }
    const bmp = await createImageBitmap(page.originalBlob);
    setRecrop({ index, url: urlRegRef.current.create(page.originalBlob), width: bmp.width, height: bmp.height });
    bmp.close?.();
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
      const url = urlRegRef.current.create(file);
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
      // Save under the company selected in this tab, never the home company.
      const importTenantId = effectiveTenantId;
      if (!importTenantId) throw new Error('No active company selected');

      const timestamp = Date.now();
      const sanitizedLabel = (documentName?.trim() || documentLabel).replace(/[^\w.-]+/g, '_');
      const fileName = `${importTenantId}/${sessionKey}/${timestamp}_${documentType}.pdf`;
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
        record_type: recordType,
        ...(recordType === 'commercial_project' && recordId ? { commercial_project_id: recordId } : {}),
        record_id: sessionKey,
        original_file_size_bytes: file.size,
      };

      const { data: insertedDoc, error: dbError } = await supabase
        .from('documents').insert({
          tenant_id: importTenantId,
          ...recordLinkColumns(recordType, recordId, pipelineEntryId),
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
      // Persist the source PDF's identity so the final upload metadata can
      // reference both the original and rebuilt artifacts.
      importedPdfSourceRef.current = {
        name: file.name,
        size: file.size,
        pageCount: rendered.length,
      };
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
          preview: urlRegRef.current.create(blob),
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
      // Never fall back to the home company: the scan must go to the company selected in this tab.
      const tenantId = effectiveTenantId;
      if (!tenantId) throw new Error('Company not selected yet — pages are kept, try again in a moment.');
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        setUploadStatus('waiting_for_connection');
        throw new Error('No connection. Pages are saved on this device; upload will retry when you reconnect.');
      }
      setUploadStatus('uploading');
      const uploadId = getOrCreateUploadId(tenantId, sessionKey, documentType);
      // A previous attempt may have saved the row before the connection dropped: reuse it.
      const { data: already } = await (supabase as any).from('documents').select('id')
        .eq('tenant_id', tenantId).eq('metadata->>client_upload_id', uploadId).maybeSingle();
      if (already?.id) {
        clearUploadId(tenantId, sessionKey, documentType);
        clearScanSession(sessionKey, documentType).catch(() => {});
        setUploadStatus('completed');
        toast({ title: 'Already saved', description: 'This scan was saved on an earlier attempt — no duplicate created.' });
        setCapturedPages([]);
        onOpenChange(false);
        onUploadComplete?.();
        return;
      }

      setUploadProgress(10);
      const profileCfg = PDF_PROFILES[pdfProfile];
      const pdfBuildStart = performance.now();
      const { blob: pdfBlob, dpi, quality, compressed, pdfFormat, ladderUsed } =
        await generateCombinedPDF(capturedPages);
      telemetryRef.current.mark('pdfBuildMs', performance.now() - pdfBuildStart);
      telemetryRef.current.setPages(capturedPages.length);
      telemetryRef.current.setFinalBytes(pdfBlob.size);

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

      // Searchable layer: OCR runs locally on each processed page image; the text sits invisibly
      // behind the unchanged scan image and is never used to rewrite or "correct" wording.
      let finalPdf: Blob = pdfBlob;
      let ocrSummary: ScanOcrSummary | null = null;
      if (searchablePdf) {
        try {
          const r = await makeScanSearchable(new Uint8Array(await pdfBlob.arrayBuffer()), capturedPages.map(p => p.blob),
            ocrSpanish ? ['spa'] : [], f => setUploadProgress(50 + Math.round(f * 15)));
          ocrSummary = r.summary;
          if (r.summary.status === 'searchable') finalPdf = new Blob([r.bytes as BlobPart], { type: 'application/pdf' });
          else toast({ title: 'Saved as image-only PDF', description: 'No readable text could be verified in the saved file.' });
          if (r.summary.low_quality_pages.length) toast({ title: 'Low-quality text', description: `Page(s) ${r.summary.low_quality_pages.join(', ')} may be hard to search. The scan image is unaffected.` });
        } catch (e: any) {
          ocrSummary = { status: 'failed', languages: '', pages: [], words_written: 0, words_skipped: 0, verified_searchable: false, low_quality_pages: [], error: String(e?.message ?? e) };
          toast({ title: 'Text recognition failed', description: 'Saving the scan as an image-only PDF.' });
        }
      }

      const timestamp = Date.now();
      const sanitizedLabel = (documentName?.trim() || documentLabel).replace(/[^\w.-]+/g, '_');
      const folder = sessionKey;
      const paths = scanUploadPaths(tenantId, folder, uploadId, documentType, capturedPages.length);
      const fileName = paths.pdf;
      void timestamp;

      const uploadStart = performance.now();
      const { error: uploadError } = await supabase.storage
        .from('documents').upload(fileName, finalPdf, { contentType: 'application/pdf', upsert: true });
      if (uploadError) throw uploadError;
      // Keep the untouched camera photos next to the PDF (never altered).
      const originalPhotoPaths: string[] = [];
      for (let i = 0; i < capturedPages.length; i++) {
        const ob = capturedPages[i].originalBlob;
        if (!ob) continue;
        const op = paths.originals[i];
        const { error: oe } = await supabase.storage.from('documents').upload(op, ob, { contentType: 'image/jpeg', upsert: true });
        if (oe) throw new Error(`Could not save original photo for page ${i + 1}: ${oe.message}`);
        originalPhotoPaths.push(op);
      }
      telemetryRef.current.mark('uploadMs', performance.now() - uploadStart);
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
        client_upload_id: uploadId,
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
        original_photo_paths: originalPhotoPaths,
        record_type: recordType,
        ...(recordType === 'commercial_project' && recordId ? { commercial_project_id: recordId } : {}),
        record_id: sessionKey,
        document_category: documentCategory ?? documentType,
        captured_by: user.id,
        searchable_pdf_requested: searchablePdf,
        ocr: ocrSummary,
        cleanup_modes_per_page: capturedPages.map(p => p.scanMode ?? null),
        ink_review_pages: capturedPages.map((p, i) => (p.inkReview ? i + 1 : null)).filter(Boolean),
        qa_warnings_acknowledged: qaAcknowledged,
        actual_size_bytes: pdfBlob.size,
        page_size_overrides: capturedPages.map(p => p.pageSizeOverride ?? null),
        edge_cleanup_applied: capturedPages.map(p => !!p.edgeCleanupApplied),
        duplicate_warning_pages: capturedPages.filter(p => p.duplicateWarning).length,
        imported_pdf_mode: capturedPages.every(p => p.captureMethod === 'imported_pdf_rebuilt') ? 'cleaned_rebuilt' as const : undefined,
        // When every page came from a rebuilt import, carry the source PDF's
        // identity forward so the rebuilt artifact can be traced back.
        imported_pdf_source: capturedPages.every(p => p.captureMethod === 'imported_pdf_rebuilt') && importedPdfSourceRef.current
          ? {
              original_filename: importedPdfSourceRef.current.name,
              original_file_size_bytes: importedPdfSourceRef.current.size,
              imported_page_count: importedPdfSourceRef.current.pageCount,
              rebuilt_file_size_bytes: pdfBlob.size,
            }
          : undefined,
        autosave_enabled: autosaveEnabledRef.current,
        autosave_disabled_reason: autosaveDisabledReasonRef.current,
        autosave_bytes_estimated: autosaveBytesRef.current || undefined,
        device_memory_gb: deviceProfileRef.current.deviceMemoryGb,
        is_low_memory_device: deviceProfileRef.current.isLowMemory,
        telemetry: telemetryRef.current.snapshot(),
        pdfjs: capturedPages.some(p => p.captureMethod === 'imported_pdf_rebuilt')
          ? getPdfjsDiagnostics()
          : undefined,
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
          tenant_id: tenantId,
          ...recordLinkColumns(recordType, recordId, pipelineEntryId),
          document_type: documentType,
          filename: `${sanitizedLabel}.pdf`,
          file_path: fileName,
          file_size: finalPdf.size,
          mime_type: 'application/pdf',
          uploaded_by: user.id,
          description: `Scanned ${capturedPages.length}-page ${documentLabel}`,
          page_count: capturedPages.length,
          scan_source: capturedPages.every(p => p.captureMethod === 'imported_pdf_rebuilt') ? 'imported_pdf' : 'camera',
          metadata: scanMetadata,
          scan_quality: scanQuality,
          ocr_status: ocrSummary?.status === 'searchable' ? 'completed' : 'processing',
        } as any).select('id').single();
      // 23505 = the row from an earlier attempt already exists (unique upload id): treat as saved.
      if (dbError && (dbError as any).code !== '23505') throw dbError;
      // Only confirmed once the server returns the saved row for this company.
      const { data: confirmed } = await (supabase as any).from('documents').select('id, tenant_id')
        .eq('tenant_id', tenantId).eq('metadata->>client_upload_id', uploadId).maybeSingle();
      if (!confirmed?.id) throw new Error('The server did not confirm the saved document. Pages kept — retry.');
      setUploadStatus(ocrSummary?.status === 'searchable' ? 'completed' : 'processing_ocr');
      clearUploadId(tenantId, sessionKey, documentType);

      if (insertedDoc?.id && ocrSummary?.status !== 'searchable') {
        supabase.functions.invoke('ocr-scanned-document', { body: { document_id: insertedDoc.id } })
          .catch(e => console.warn('[scanner] OCR invoke failed:', e));
      }
      setUploadProgress(100);
      toast({ title: 'PDF Created', description: `${capturedPages.length}-page PDF uploaded.` });

      telemetryRef.current.finish();
      capturedPages.forEach(p => { try { urlRegRef.current.revoke(p.preview); } catch {} });
      urlRegRef.current.revokeAll();
      setCapturedPages([]);
      // Clear persisted scan session once the upload succeeds.
      clearScanSession(sessionKey, documentType).catch(() => {});
      onOpenChange(false);
      onUploadComplete?.();
    } catch (err: any) {
      console.error('PDF generation error:', err);
      // Failure-recovery: keep pages + autosave so the user can retry from QA.
      setUploadStatus(s => s === 'waiting_for_connection' ? s : (navigator.onLine === false ? 'waiting_for_connection' : 'failed'));
      toast({ title: 'Upload Failed', description: (err?.message || 'Failed to create PDF.') + ' Pages preserved — try again.', variant: 'destructive' });
      setShowQA(true);
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  const handleClose = () => {
    if (capturedPages.length > 0 && !isUploading) {
      const proceed = confirm(
        `Keep ${capturedPages.length} captured page${capturedPages.length > 1 ? 's' : ''} for next time? ` +
        `Click OK to keep, Cancel to discard.`
      );
      if (!proceed) {
        clearScanSession(sessionKey, documentType).catch(() => {});
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
      telemetry: telemetryRef.current.snapshot(),
      pdfjs: getPdfjsDiagnostics(),
      autosave: {
        enabled: autosaveEnabledRef.current,
        disabled_reason: autosaveDisabledReasonRef.current,
        bytes_estimated: autosaveBytesRef.current,
      },
      device: deviceProfileRef.current,
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
        setManualCropImage({ url: urlRegRef.current.create(blob), width: hi.canvas.width, height: hi.canvas.height });
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

  if (recrop) {
    const page = capturedPages[recrop.index];
    return (
      <ManualCropOverlay
        imageUrl={recrop.url}
        initialCorners={page?.edit?.corners ?? null}
        imageWidth={recrop.width}
        imageHeight={recrop.height}
        onConfirm={(c) => {
          const i = recrop.index; urlRegRef.current.revoke(recrop.url); setRecrop(null);
          applyEdit([i], { corners: { ...(page?.edit?.corners ?? {}), ...c } as DetectedCornersExt });
        }}
        onCancel={() => { urlRegRef.current.revoke(recrop.url); setRecrop(null); }}
      />
    );
  }

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
        <div className="flex-shrink-0 px-3 py-2 border-b grid grid-cols-3 gap-2 bg-muted/20">
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
            <Label className="text-xs text-muted-foreground">Cleanup</Label>
            <Select value={scanMode} onValueChange={(v) => setScanMode(v as ScanMode)}>
              <SelectTrigger className="h-8 text-xs" aria-label="Cleanup mode"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SCAN_MODES.map(m => (
                  <SelectItem key={m.mode} value={m.mode}>{m.label} — {m.hint}</SelectItem>
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
          <label className="flex items-center gap-1.5 cursor-pointer" title="Adds invisible, searchable text behind the scan image. The scan itself is never replaced.">
            <Switch checked={searchablePdf} onCheckedChange={setSearchablePdf} className="scale-75" aria-label="Searchable PDF" />
            Searchable PDF
          </label>
          {searchablePdf && (
            <label className="flex items-center gap-1.5 cursor-pointer">
              <Switch checked={ocrSpanish} onCheckedChange={setOcrSpanish} className="scale-75" aria-label="Also read Spanish" />
              + Spanish
            </label>
          )}
          <label className="flex items-center gap-1.5 cursor-pointer">
            <Switch checked={burnPageNumbers} onCheckedChange={setBurnPageNumbers} className="scale-75" />
            Burn page #
          </label>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            className="ml-auto flex items-center gap-1 px-2 py-0.5 rounded hover:bg-muted text-muted-foreground"
            aria-label="Scanner settings"
          >
            <SettingsIcon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Settings</span>
          </button>
          {isDev && (
            <label className="flex items-center gap-1.5 cursor-pointer">
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
              <img src={showBefore && previewPage.beforePreview ? previewPage.beforePreview : previewPage.preview} alt={`Page ${previewIndex + 1}`} className="max-w-full max-h-full object-contain" />
            </div>
            {previewPage.edit && (
              <div className="flex-shrink-0 bg-background border-t p-3 space-y-2 text-sm" onClick={(e) => e.stopPropagation()}>
                {previewPage.inkReview && (
                  <p className="text-destructive text-xs">This cleanup may have removed handwriting or a signature. Compare Before/After, lower the cleanup, or choose Original.</p>
                )}
                <div className="flex flex-wrap gap-1">
                  {SCAN_MODES.map((m) => (
                    <Button key={m.mode} size="sm" disabled={editBusy}
                      variant={previewPage.edit!.mode === m.mode ? 'default' : 'outline'}
                      onClick={() => applyEdit([previewIndex], { mode: m.mode })}>{m.label}</Button>
                  ))}
                </div>
                {([
                  ['intensity', 'Cleanup strength', 0.5, 1.5, 0.1],
                  ['brightness', 'Brightness', -60, 60, 5],
                  ['contrast', 'Contrast', 0.5, 1.5, 0.05],
                ] as const).map(([k, label, min, max, step]) => (
                  <label key={k} className="flex items-center gap-2">
                    <span className="w-32 text-muted-foreground">{label}</span>
                    <input type="range" min={min} max={max} step={step} disabled={editBusy}
                      key={`${previewIndex}-${k}-${previewPage.edit![k]}`}
                      defaultValue={previewPage.edit![k]} className="flex-1 accent-primary"
                      onPointerUp={(ev) => applyEdit([previewIndex], { [k]: Number((ev.target as HTMLInputElement).value) })}
                      onKeyUp={(ev) => applyEdit([previewIndex], { [k]: Number((ev.target as HTMLInputElement).value) })} />
                    <span className="w-10 text-right tabular-nums">{previewPage.edit![k]}</span>
                  </label>
                ))}
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" disabled={!previewPage.beforePreview}
                    onPointerDown={() => setShowBefore(true)} onPointerUp={() => setShowBefore(false)} onPointerLeave={() => setShowBefore(false)}>
                    Hold for Before
                  </Button>
                  <Button size="sm" variant="outline" disabled={editBusy} onClick={() => openRecrop(previewIndex)}>Adjust corners</Button>
                  <Button size="sm" variant="outline" disabled={editBusy || !previewPage.editHistory?.length} onClick={() => applyEdit([previewIndex], {}, { undo: true })}>Undo</Button>
                  <Button size="sm" variant="outline" disabled={editBusy}
                    onClick={() => applyEdit([previewIndex], { ...DEFAULT_RESTORE_OPTIONS, corners: previewPage.editHistory?.[0]?.corners ?? previewPage.edit!.corners, mode: 'auto' })}>Reset</Button>
                  <Button size="sm" variant="outline" disabled={editBusy || capturedPages.length < 2}
                    onClick={() => {
                      const { mode, intensity, brightness, contrast } = previewPage.edit!;
                      applyEdit(capturedPages.map((_, i) => i), { mode, intensity, brightness, contrast });
                    }}>Apply to all pages</Button>
                  {editBusy && <span className="text-muted-foreground self-center">Reprocessing…</span>}
                </div>
              </div>
            )}
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
                  await clearScanSession(sessionKey, documentType);
                  setResumePromptSession(null);
                  setPendingResumePages(null);
                }}>Discard</Button>
                <Button size="sm" onClick={async () => {
                  if (pendingResumePages) {
                    const restored: CapturedPage[] = pendingResumePages.map((p) => ({
                      blob: p.blob,
                      preview: urlRegRef.current.create(p.blob),
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
                beforePreview: p.beforePreview,
                inkReview: p.inkReview,
                scanModeLabel: SCAN_MODES.find(m => m.mode === p.scanMode)?.label,
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

        {/* Compact settings + diagnostics panel */}
        <ScannerSettingsPanel
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          settings={{
            preset: scanPreset,
            pdfProfile,
            autoCapture,
            burnPageNumbers,
            autosaveEnabled,
          }}
          onChange={(next: ScannerSettings) => {
            setScanPreset(next.preset);
            if (next.pdfProfile !== pdfProfile) {
              userPickedProfileRef.current = true;
              if (next.pdfProfile === 'archive' && deviceProfileRef.current.isLowMemory) {
                toast({
                  title: 'Archive mode may be slow on this device',
                  description: 'Lower-memory device detected — large scans may stall.',
                });
              }
              setPdfProfile(next.pdfProfile);
            }
            setAutoCapture(next.autoCapture);
            setBurnPageNumbers(next.burnPageNumbers);
            if (next.autosaveEnabled !== autosaveEnabled) {
              autosaveEnabledRef.current = next.autosaveEnabled;
              autosaveDisabledReasonRef.current = next.autosaveEnabled ? null : 'user_disabled';
              setAutosaveEnabled(next.autosaveEnabled);
            }
          }}
          diagnosticsText={JSON.stringify({
            scanner_version: SCANNER_VERSION,
            scanner_session_id: scannerSessionIdRef.current,
            telemetry: telemetryRef.current.snapshot(),
            pdfjs: getPdfjsDiagnostics(),
            device: deviceProfileRef.current,
            autosave: {
              enabled: autosaveEnabledRef.current,
              disabled_reason: autosaveDisabledReasonRef.current,
              bytes_estimated: autosaveBytesRef.current,
            },
            page_count: capturedPages.length,
          }, null, 2)}
        />
      </DialogContent>
    </Dialog>
  );
}
