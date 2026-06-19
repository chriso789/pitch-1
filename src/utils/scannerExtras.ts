/**
 * Scanner extras: scan presets, high-res capture helper, shadow severity,
 * canvas rotation, and capture-method types. Kept separate from the main
 * enhancement pipeline so it can evolve without touching working code paths.
 */

import type { QualityFlags } from './documentQuality';

// ============================================================================
// Scan presets
// ============================================================================

export type ScanPreset = 'contract' | 'color' | 'photo';

export interface ScanPresetConfig {
  preset: ScanPreset;
  label: string;
  colorMode: 'color' | 'bw';
  illuminationCorrection: boolean;
  whiteBackground: boolean;
  sharpen: boolean;
  /** Inward inset applied after perspective warp (fraction of width, 0..0.02). */
  inwardInsetPct: number;
  /** Stronger background estimation kernel for full-page shadow correction. */
  largeShadowKernel: boolean;
  /** Tag for metadata. */
  enhancementProfile: string;
}

export const SCAN_PRESETS: Record<ScanPreset, ScanPresetConfig> = {
  contract: {
    preset: 'contract',
    label: 'Contract / Text',
    colorMode: 'bw',
    illuminationCorrection: true,
    whiteBackground: true,
    sharpen: false,
    inwardInsetPct: 0.01,
    largeShadowKernel: true,
    enhancementProfile: 'contract_bw_v1',
  },
  color: {
    preset: 'color',
    label: 'Color Document',
    colorMode: 'color',
    illuminationCorrection: true,
    whiteBackground: true,
    sharpen: true,
    inwardInsetPct: 0.008,
    largeShadowKernel: true,
    enhancementProfile: 'color_doc_v1',
  },
  photo: {
    preset: 'photo',
    label: 'Photo Evidence',
    colorMode: 'color',
    illuminationCorrection: false,
    whiteBackground: false,
    sharpen: false,
    inwardInsetPct: 0,
    largeShadowKernel: false,
    enhancementProfile: 'photo_raw_v1',
  },
};

export const DEFAULT_SCAN_PRESET: ScanPreset = 'contract';

// ============================================================================
// PDF quality profiles
// ============================================================================

export type PdfProfile = 'standard' | 'high' | 'archive';

export interface PdfProfileConfig {
  profile: PdfProfile;
  label: string;
  /** Initial DPI of the compression ladder. */
  dpi: number;
  /** Initial JPEG quality of the compression ladder. */
  jpegQuality: number;
  /** Max acceptable PDF size in bytes; if 0 there is no cap. */
  maxBytes: number;
  /** Allow exceeding maxBytes with a user warning. */
  allowOverLimit: boolean;
}

export const PDF_PROFILES: Record<PdfProfile, PdfProfileConfig> = {
  standard: {
    profile: 'standard',
    label: 'Standard (~200 DPI, <10MB)',
    dpi: 220,
    jpegQuality: 0.78,
    maxBytes: 10 * 1024 * 1024,
    allowOverLimit: false,
  },
  high: {
    profile: 'high',
    label: 'High (~300 DPI)',
    dpi: 300,
    jpegQuality: 0.85,
    maxBytes: 25 * 1024 * 1024,
    allowOverLimit: true,
  },
  archive: {
    profile: 'archive',
    label: 'Archive (300 DPI, max clarity)',
    dpi: 300,
    jpegQuality: 0.92,
    maxBytes: 40 * 1024 * 1024,
    allowOverLimit: true,
  },
};

export const DEFAULT_PDF_PROFILE: PdfProfile = 'standard';

// ============================================================================
// Capture method
// ============================================================================

export type CaptureMethod =
  | 'image_capture_take_photo'
  | 'video_frame_canvas'
  | 'imported_photo'
  | 'imported_pdf';

export interface HighResCaptureResult {
  canvas: HTMLCanvasElement;
  method: CaptureMethod;
  sourceWidth: number;
  sourceHeight: number;
}

/**
 * Try `ImageCapture.takePhoto()` for the best still resolution; fall back to
 * grabbing the current video frame onto a canvas. Never throws — always
 * returns at least the video-frame canvas.
 */
export async function captureHighResFrame(
  video: HTMLVideoElement,
  stream: MediaStream | null,
): Promise<HighResCaptureResult> {
  const fallback = (): HighResCaptureResult => {
    const c = document.createElement('canvas');
    c.width = video.videoWidth;
    c.height = video.videoHeight;
    const ctx = c.getContext('2d');
    if (ctx) ctx.drawImage(video, 0, 0);
    return {
      canvas: c,
      method: 'video_frame_canvas',
      sourceWidth: video.videoWidth,
      sourceHeight: video.videoHeight,
    };
  };

  if (!stream || typeof (window as any).ImageCapture !== 'function') {
    return fallback();
  }
  const track = stream.getVideoTracks()[0];
  if (!track) return fallback();

  try {
    const ImageCaptureCtor = (window as any).ImageCapture;
    const ic = new ImageCaptureCtor(track);
    const blob: Blob = await Promise.race([
      ic.takePhoto(),
      new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error('takePhoto timeout')), 2500),
      ),
    ]);
    const bitmap = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = bitmap.width;
    c.height = bitmap.height;
    const ctx = c.getContext('2d');
    if (ctx) ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    return {
      canvas: c,
      method: 'image_capture_take_photo',
      sourceWidth: c.width,
      sourceHeight: c.height,
    };
  } catch {
    return fallback();
  }
}

/**
 * Best-effort continuous focus / exposure. Silent on failure.
 */
export async function applyContinuousFocus(stream: MediaStream | null): Promise<void> {
  if (!stream) return;
  const track = stream.getVideoTracks()[0];
  if (!track) return;
  try {
    const caps: any = track.getCapabilities?.() ?? {};
    const constraints: any = {};
    if (Array.isArray(caps.focusMode) && caps.focusMode.includes('continuous')) {
      constraints.focusMode = 'continuous';
    }
    if (Array.isArray(caps.exposureMode) && caps.exposureMode.includes('continuous')) {
      constraints.exposureMode = 'continuous';
    }
    if (Array.isArray(caps.whiteBalanceMode) && caps.whiteBalanceMode.includes('continuous')) {
      constraints.whiteBalanceMode = 'continuous';
    }
    if (Object.keys(constraints).length > 0) {
      await track.applyConstraints({ advanced: [constraints] });
    }
  } catch {
    // Unsupported — that's fine.
  }
}

// ============================================================================
// Shadow severity from quality flags
// ============================================================================

export type ShadowSeverity = 'none' | 'light' | 'moderate' | 'heavy';

export function classifyShadowSeverity(flags: QualityFlags | null): ShadowSeverity {
  if (!flags) return 'none';
  const r = flags.underexposed_ratio ?? 0;
  if (r >= 0.32) return 'heavy';
  if (r >= 0.20) return 'moderate';
  if (r >= 0.10) return 'light';
  return 'none';
}

// ============================================================================
// Canvas rotation (used in page-preview rotate)
// ============================================================================

export function rotateCanvas(
  source: HTMLCanvasElement,
  degrees: 90 | -90 | 180,
): HTMLCanvasElement {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d');
  if (!ctx) return source;
  const rad = (degrees * Math.PI) / 180;
  if (degrees === 180) {
    c.width = source.width;
    c.height = source.height;
  } else {
    c.width = source.height;
    c.height = source.width;
  }
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate(rad);
  ctx.drawImage(source, -source.width / 2, -source.height / 2);
  return c;
}

export async function rotateBlob(
  blob: Blob,
  degrees: 90 | -90 | 180,
  mimeType: string = 'image/jpeg',
  quality: number = 0.95,
): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  const src = document.createElement('canvas');
  src.width = bitmap.width;
  src.height = bitmap.height;
  const sctx = src.getContext('2d');
  if (!sctx) {
    bitmap.close();
    return blob;
  }
  sctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const rotated = rotateCanvas(src, degrees);
  return await new Promise<Blob>((resolve) =>
    rotated.toBlob((b) => resolve(b ?? blob), mimeType, quality),
  );
}

/** Crop a canvas inward by `pct` (fraction of its dimensions) to remove edge bleed. */
export function inwardInsetCanvas(source: HTMLCanvasElement, pct: number): HTMLCanvasElement {
  if (!pct || pct <= 0) return source;
  const insetX = Math.round(source.width * pct);
  const insetY = Math.round(source.height * pct);
  const w = Math.max(1, source.width - insetX * 2);
  const h = Math.max(1, source.height - insetY * 2);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return source;
  ctx.drawImage(source, insetX, insetY, w, h, 0, 0, w, h);
  return c;
}
