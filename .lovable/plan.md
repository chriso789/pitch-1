

# Plan: Professional Document Scanner Upgrade

## Executive Summary

This upgrade transforms the document scanner from a "good enough" mobile scanner to a **Genius Scan-quality** professional scanning system. The key improvements address:

1. **Background leaking into scans** - Documents captured with table/floor visible
2. **Unstable edge detection** - Corners jump around, detection flickers
3. **Shadow artifacts** - Hand shadows and uneven lighting degrade output
4. **No fallback** - When detection fails, full frame is captured instead of cropping
5. **Quality inconsistency** - Output quality varies widely

---

## What Users Will Experience After Upgrade

| Before | After |
|--------|-------|
| Table/floor visible in final PDF | Clean, cropped document only |
| "Document Detected" flickers on/off | Stable detection with smooth corners |
| Hand shadows visible in output | Clean white background |
| No option to manually adjust corners | Drag-to-adjust corner handles |
| Capture allowed even with bad detection | Smart capture gating with quality checks |

---

## Architecture Overview

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                        DOCUMENT SCANNER PIPELINE                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────┐    ┌──────────────────┐    ┌──────────────────────┐  │
│  │   Camera     │───>│  Edge Detection  │───>│  Stability Filter    │  │
│  │   Stream     │    │  (OpenCV + FBck) │    │  (Rolling Buffer)    │  │
│  └──────────────┘    └──────────────────┘    └──────────────────────┘  │
│                                                        │                │
│                                                        v                │
│                              ┌─────────────────────────────────────┐    │
│                              │           Capture Gate              │    │
│                              │  Stable? ──> Auto Crop              │    │
│                              │  Unstable? ──> Manual Crop Overlay  │    │
│                              └─────────────────────────────────────┘    │
│                                                        │                │
│                                                        v                │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                    ENHANCEMENT PIPELINE                          │  │
│  │  1. Perspective Transform (ALWAYS applied with corners)          │  │
│  │  2. Illumination Normalization (fix uneven lighting)             │  │
│  │  3. White Background Enforcement                                 │  │
│  │  4. Sauvola Binarization (BW) OR Color Enhancement               │  │
│  │  5. Edge-Preserving Sharpening                                   │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                        │                │
│                                                        v                │
│                              ┌─────────────────────────────────────┐    │
│                              │   Multi-Page PDF Generation         │    │
│                              │   (Letter/A4 @ 300 DPI)             │    │
│                              └─────────────────────────────────────┘    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Technical Implementation Details

### Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `src/utils/documentEdgeDetectionOpenCV.ts` | **CREATE** | OpenCV.js-based edge detection with Canny + contour finding |
| `src/utils/documentStability.ts` | **CREATE** | Rolling buffer for corner stability and jitter scoring |
| `src/components/documents/ManualCropOverlay.tsx` | **CREATE** | Draggable corner handles for manual adjustment |
| `src/utils/documentEnhancementPro.ts` | **CREATE** | Enhanced pipeline with illumination correction |
| `src/components/documents/DocumentScannerDialog.tsx` | **MODIFY** | Integrate all new components |
| `src/utils/documentEdgeDetection.ts` | **KEEP** | Remains as fallback detector |
| `src/utils/documentEnhancement.ts` | **KEEP** | Base enhancement functions |

---

### 1. OpenCV.js Edge Detection (`documentEdgeDetectionOpenCV.ts`)

**Why OpenCV.js?**
- Industry-standard contour detection algorithms
- Canny edge detection with automatic thresholds
- `approxPolyDP` for reliable quadrilateral detection
- Battle-tested on millions of document scans

**Implementation Approach:**
```typescript
// Lazy load OpenCV.js only when scanner opens (avoid 8MB bundle in main app)
let cv: any = null;
let cvLoading: Promise<void> | null = null;

async function loadOpenCV(): Promise<void> {
  if (cv) return;
  if (cvLoading) return cvLoading;
  
  cvLoading = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://docs.opencv.org/4.8.0/opencv.js';
    script.onload = () => {
      // OpenCV.js sets global cv variable when ready
      (window as any).cv['onRuntimeInitialized'] = () => {
        cv = (window as any).cv;
        resolve();
      };
    };
    script.onerror = reject;
    document.body.appendChild(script);
  });
  
  return cvLoading;
}

export async function detectDocumentEdgesOpenCV(imageData: ImageData): Promise<DetectedCorners | null> {
  // 1. Grayscale conversion
  // 2. GaussianBlur
  // 3. Canny edge detection (dynamic thresholds using median)
  // 4. Morphological close/open to connect edges
  // 5. findContours
  // 6. Score contours and pick best quadrilateral
}
```

**Scoring Algorithm:**
- Largest area within bounds (but NOT full-frame)
- Approximates to exactly 4 points with `approxPolyDP`
- Aspect ratio near paper (letter: 1.29, A4: 1.41, tolerance ±0.3)
- Convexity check (must be convex)
- Edge-border penalty (corners too close to image edge are penalized)

---

### 2. Stability Filter (`documentStability.ts`)

**Problem:** Even good detection produces jittery corners frame-to-frame.

**Solution:** Rolling buffer with statistical analysis

```typescript
interface StabilityResult {
  stable: boolean;
  averagedCorners: DetectedCorners | null;
  jitterScore: number;  // 0 = perfectly stable, higher = more jitter
  framesSinceStable: number;
}

class CornerStabilityBuffer {
  private buffer: DetectedCorners[] = [];
  private readonly bufferSize = 8;  // Last 8 frames
  private readonly jitterThreshold = 15;  // Max pixels of deviation
  private readonly minStableFrames = 5;   // Need 5/8 consistent detections
  
  addFrame(corners: DetectedCorners | null): StabilityResult {
    // 1. Add to rolling buffer
    // 2. Calculate average corner positions
    // 3. Calculate standard deviation (jitter)
    // 4. Check if jitter < threshold for enough frames
    // 5. Return stabilized corners (averaged) if stable
  }
}
```

**UI Indicators:**
- Show "Document Detected" only when `stable === true`
- Use averaged corners for overlay (smooth animation)
- Pulse animation when transitioning to stable state

---

### 3. Manual Crop Overlay (`ManualCropOverlay.tsx`)

**Triggers:**
- Auto detection confidence < 0.5 at capture time
- User explicitly taps "Adjust Corners" button
- Detection returned null (no quadrilateral found)

**UI Implementation:**
```tsx
interface ManualCropOverlayProps {
  imageBlob: Blob;
  initialCorners?: DetectedCorners | null;
  onConfirm: (corners: DetectedCorners) => void;
  onCancel: () => void;
}

export function ManualCropOverlay({ imageBlob, initialCorners, onConfirm, onCancel }: ManualCropOverlayProps) {
  const [corners, setCorners] = useState<Point[]>(/* 4 corners */);
  
  // Draggable corner handles
  // Show captured image as background
  // Draw quadrilateral overlay connecting corners
  // "Confirm" button applies perspective transform with these corners
}
```

**UX Details:**
- Large touch targets (48x48px minimum) for corner handles
- Haptic feedback on drag (if available via Capacitor)
- Magnifier loupe when dragging (optional, performance permitting)
- Default corners: centered rectangle if no detection available

---

### 4. Enhanced Processing Pipeline (`documentEnhancementPro.ts`)

**New Features:**

#### A. Illumination Normalization (fixes shadows)
```typescript
function normalizeIllumination(data: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  // 1. Estimate background illumination using large-kernel blur (morphological open)
  // 2. Divide original by illumination map (or subtract + normalize)
  // 3. This lifts shadows without affecting text contrast
}
```

#### B. White Background Enforcement
```typescript
function enforceWhiteBackground(data: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  // 1. Sample border regions to detect background color
  // 2. Calculate background median brightness
  // 3. Normalize so background becomes ~248 (near white)
  // 4. Clamp to avoid blowing out highlights
}
```

#### C. Hand Shadow Correction
```typescript
function correctHandShadows(data: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray {
  // 1. Detect large low-frequency dark regions (shadows are smooth, text is sharp)
  // 2. Apply local normalization to lift shadow areas
  // 3. Preserve text edges using edge-aware filtering
}
```

---

### 5. Capture Gating (in DocumentScannerDialog)

**New Logic:**
```typescript
const captureAndProcess = useCallback(async () => {
  // 1. Capture current frame
  const frameCanvas = captureFrame();
  
  // 2. Check if detection is stable
  const stabilityResult = stabilityBuffer.getResult();
  
  if (stabilityResult.stable && stabilityResult.averagedCorners) {
    // AUTO MODE: Use stable corners immediately
    const processed = await processWithCorners(frameCanvas, stabilityResult.averagedCorners);
    addPage(processed);
  } else {
    // MANUAL MODE: Show crop overlay
    setManualCropImage(frameCanvas);
    setShowManualCrop(true);
  }
}, [/* deps */]);
```

---

### 6. Safety Checks

**Before accepting corners (auto or manual):**
```typescript
function validateQuadrilateral(corners: DetectedCorners, frameWidth: number, frameHeight: number): { valid: boolean; reason?: string } {
  // 1. Self-crossing check (polygon must be convex)
  if (!isConvex(corners)) return { valid: false, reason: 'Invalid shape' };
  
  // 2. Too large check (>95% of frame = probably capturing whole view)
  const area = quadArea(corners);
  const frameArea = frameWidth * frameHeight;
  if (area / frameArea > 0.95) return { valid: false, reason: 'Document too close' };
  
  // 3. Too small check (<10% of frame)
  if (area / frameArea < 0.10) return { valid: false, reason: 'Document too far' };
  
  return { valid: true };
}
```

---

### 7. Performance Optimizations

| Optimization | Implementation |
|--------------|----------------|
| **Lazy OpenCV load** | Only load 8MB OpenCV.js when scanner dialog opens |
| **Web Worker** | Run OpenCV detection in worker thread (optional, if perf issues) |
| **Downsample** | Detect on 640px max dimension, only full-res for capture |
| **Throttled detection** | Run every 200-300ms, not on every frame |
| **Canvas reuse** | Reuse temp canvases/Mats instead of reallocating |
| **requestIdleCallback** | Schedule heavy processing during idle time |

---

### 8. iOS Safari Compatibility Notes

| Issue | Solution |
|-------|----------|
| Memory pressure | Release ImageData/Mats promptly |
| Canvas size limits | Limit to 4096x4096 max |
| Video playback | `playsinline` attribute required |
| Orientation | Handle EXIF orientation in captured frames |

---

## Testing Checklist

### Functional Tests
- [ ] Document on dark table: output PDF has no table visible
- [ ] Document partially out of frame: forces manual crop
- [ ] Hand shadow across page: output readable, background mostly white
- [ ] Low light grain: output does not over-sharpen noise
- [ ] Rotated document: correctly oriented in output

### Stability Tests
- [ ] Corners don't flicker while document is steady
- [ ] "Document Detected" only appears after stable lock
- [ ] Smooth transition animations for corner overlay

### Integration Tests
- [ ] Multi-page capture works correctly
- [ ] PDF uploads to Supabase successfully
- [ ] Database record created with correct metadata
- [ ] No regression in existing upload flow

---

## Dependencies to Add

```json
{
  "dependencies": {
    // No new npm dependencies - OpenCV.js loaded from CDN
  }
}
```

OpenCV.js loaded lazily from CDN when scanner opens:
- URL: `https://docs.opencv.org/4.8.0/opencv.js`
- Size: ~8MB (loaded only when needed)
- Cached by browser after first load

---

## Summary

| Component | What It Solves |
|-----------|---------------|
| OpenCV.js edge detection | Accurate, robust boundary detection |
| Stability filter | Smooth, non-jittery corner tracking |
| Manual crop overlay | Fallback when auto-detection fails |
| Enhanced pipeline | Professional shadow/lighting correction |
| Capture gating | Prevents bad captures |
| Safety checks | Rejects invalid quadrilaterals |

**This upgrade will bring the scanner quality from "acceptable" to "Genius Scan-level professional" while maintaining full compatibility with the existing dialog interface and upload flow.**

