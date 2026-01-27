
# Plan: Professional Document Scanner with Edge Detection & Enhancement

## Overview
Transform the document scanner into a professional-grade scanning tool that:
1. **Automatically detects document edges** and highlights them in real-time
2. **Applies perspective correction** to flatten tilted documents
3. **Removes shadows and enhances clarity** using adaptive thresholding
4. **Produces print-quality PDFs** that look like the original document

---

## Architecture

```text
+----------------------------------+
|     CAPTURE PHASE               |
|  Live camera with edge overlay   |
|  [Auto-detect corners]           |
+----------------------------------+
            ↓
+----------------------------------+
|     PROCESSING PHASE             |
|  1. Detect 4 corners             |
|  2. Perspective warp to flat     |
|  3. Adaptive shadow removal      |
|  4. Contrast enhancement         |
|  5. Brightness normalization     |
+----------------------------------+
            ↓
+----------------------------------+
|     OUTPUT PHASE                 |
|  High-DPI PDF (300 DPI equiv)    |
|  Ultra-clear, print-ready        |
+----------------------------------+
```

---

## Part 1: Edge Detection Overlay (Real-Time)

### New File: `src/utils/documentEdgeDetection.ts`

A client-side edge detection utility optimized for documents:

```typescript
interface DetectedCorners {
  topLeft: { x: number; y: number };
  topRight: { x: number; y: number };
  bottomLeft: { x: number; y: number };
  bottomRight: { x: number; y: number };
  confidence: number;
}

export function detectDocumentEdges(
  imageData: ImageData
): DetectedCorners | null;
```

**Algorithm:**
1. Convert to grayscale
2. Apply Gaussian blur to reduce noise
3. Use Canny-style edge detection (Sobel + thresholding)
4. Find contours using connected component analysis
5. Detect the largest quadrilateral contour
6. Return 4 corners sorted (top-left, top-right, bottom-right, bottom-left)

### Real-Time Overlay in Camera View
- Run edge detection on every ~5th video frame (throttled)
- Draw green polygon overlay showing detected document bounds
- Show confidence indicator ("Good" / "Adjust Position")
- Auto-capture when confidence > 80% for 1 second (optional)

---

## Part 2: Perspective Correction

### New Function: `applyPerspectiveTransform`

```typescript
export function applyPerspectiveTransform(
  sourceCanvas: HTMLCanvasElement,
  corners: DetectedCorners,
  outputWidth: number,
  outputHeight: number
): HTMLCanvasElement;
```

**Algorithm:**
1. Calculate perspective transform matrix from source corners to destination rectangle
2. Apply bilinear interpolation for each destination pixel
3. Output a perfectly rectangular document image

**Implementation:**
- Use homography matrix calculation (3x3 transform)
- Apply inverse mapping for smooth output
- Standard A4/Letter aspect ratio output (8.5:11)

---

## Part 3: Shadow Removal & Enhancement

### New File: `src/utils/documentEnhancement.ts`

Professional document enhancement pipeline:

```typescript
export interface EnhancementOptions {
  mode: 'color' | 'grayscale' | 'bw';
  shadowRemoval: boolean;
  contrastBoost: number; // 1.0 = normal
  brightnessNormalize: boolean;
  sharpen: boolean;
}

export function enhanceDocument(
  canvas: HTMLCanvasElement,
  options: EnhancementOptions
): HTMLCanvasElement;
```

**Processing Pipeline:**

#### 3.1 Adaptive Shadow Removal
```typescript
function adaptiveShadowRemoval(imageData: ImageData): ImageData {
  // 1. Calculate local mean brightness in 15x15 blocks
  // 2. Normalize each pixel relative to local background
  // 3. This removes uneven lighting and shadows
}
```

#### 3.2 Sauvola Binarization (for B&W mode)
```typescript
function sauvolaBinarization(imageData: ImageData, k: number = 0.2): ImageData {
  // Adaptive thresholding that handles shadows
  // T(x,y) = mean(x,y) * (1 + k * (std(x,y)/R - 1))
  // Where R is dynamic range (128 for 8-bit)
}
```

#### 3.3 Contrast Enhancement
```typescript
function enhanceContrast(imageData: ImageData, factor: number): ImageData {
  // Stretch histogram to use full 0-255 range
  // Apply S-curve for natural contrast boost
}
```

#### 3.4 Unsharp Mask Sharpening
```typescript
function unsharpMask(imageData: ImageData, amount: number = 0.5): ImageData {
  // Sharpen text edges for crisp output
  // output = original + amount * (original - blurred)
}
```

---

## Part 4: Scanner UI Enhancements

### Updates to `DocumentScannerDialog.tsx`

#### 4.1 New State & Imports
```typescript
import { detectDocumentEdges, DetectedCorners } from '@/utils/documentEdgeDetection';
import { enhanceDocument, applyPerspectiveTransform } from '@/utils/documentEnhancement';

const [detectedCorners, setDetectedCorners] = useState<DetectedCorners | null>(null);
const [processingMode, setProcessingMode] = useState<'color' | 'bw'>('bw'); // B&W default for docs
const [isProcessing, setIsProcessing] = useState(false);
```

#### 4.2 Edge Detection Loop
```typescript
// Run every 200ms while camera is active
useEffect(() => {
  if (!cameraReady || !videoRef.current) return;
  
  const interval = setInterval(() => {
    const video = videoRef.current!;
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = video.videoWidth / 4; // Downsample for speed
    tempCanvas.height = video.videoHeight / 4;
    const ctx = tempCanvas.getContext('2d')!;
    ctx.drawImage(video, 0, 0, tempCanvas.width, tempCanvas.height);
    
    const imageData = ctx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
    const corners = detectDocumentEdges(imageData);
    
    if (corners) {
      // Scale corners back to full resolution
      setDetectedCorners({
        ...corners,
        topLeft: { x: corners.topLeft.x * 4, y: corners.topLeft.y * 4 },
        // ... scale all corners
      });
    }
  }, 200);
  
  return () => clearInterval(interval);
}, [cameraReady]);
```

#### 4.3 Enhanced Capture Function
```typescript
const captureAndProcess = useCallback(async () => {
  if (!videoRef.current || !canvasRef.current) return;
  
  setIsProcessing(true);
  
  // 1. Capture full-resolution frame
  const video = videoRef.current;
  const canvas = canvasRef.current;
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(video, 0, 0);
  
  // 2. Apply perspective correction if edges detected
  let processedCanvas = canvas;
  if (detectedCorners && detectedCorners.confidence > 0.5) {
    processedCanvas = applyPerspectiveTransform(
      canvas,
      detectedCorners,
      2550, // 8.5" at 300 DPI
      3300  // 11" at 300 DPI
    );
  }
  
  // 3. Apply enhancement pipeline
  const enhanced = enhanceDocument(processedCanvas, {
    mode: processingMode,
    shadowRemoval: true,
    contrastBoost: 1.3,
    brightnessNormalize: true,
    sharpen: true,
  });
  
  // 4. Convert to blob and add to pages
  enhanced.toBlob((blob) => {
    if (blob) {
      const preview = URL.createObjectURL(blob);
      setCapturedPages(prev => [...prev, { blob, preview }]);
    }
    setIsProcessing(false);
  }, 'image/jpeg', 0.95);
  
}, [detectedCorners, processingMode]);
```

#### 4.4 Edge Overlay UI
```tsx
{/* Edge detection overlay */}
{cameraReady && detectedCorners && (
  <svg 
    className="absolute inset-0 pointer-events-none"
    viewBox={`0 0 ${videoWidth} ${videoHeight}`}
  >
    <polygon
      points={`
        ${detectedCorners.topLeft.x},${detectedCorners.topLeft.y}
        ${detectedCorners.topRight.x},${detectedCorners.topRight.y}
        ${detectedCorners.bottomRight.x},${detectedCorners.bottomRight.y}
        ${detectedCorners.bottomLeft.x},${detectedCorners.bottomLeft.y}
      `}
      fill="rgba(34, 197, 94, 0.2)"
      stroke="#22c55e"
      strokeWidth="3"
    />
    {/* Corner markers */}
    {Object.values(detectedCorners).filter(c => typeof c === 'object').map((corner, i) => (
      <circle
        key={i}
        cx={corner.x}
        cy={corner.y}
        r="12"
        fill="#22c55e"
        stroke="white"
        strokeWidth="2"
      />
    ))}
  </svg>
)}

{/* Detection status indicator */}
{cameraReady && (
  <div className={cn(
    "absolute top-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-full text-sm font-medium",
    detectedCorners?.confidence > 0.7 
      ? "bg-green-500/90 text-white" 
      : "bg-yellow-500/90 text-white"
  )}>
    {detectedCorners?.confidence > 0.7 ? '✓ Document Detected' : 'Position document in frame'}
  </div>
)}
```

#### 4.5 Mode Toggle
```tsx
{/* Enhancement mode selector */}
<div className="flex gap-2 px-4 py-2 border-t bg-muted/30">
  <Button
    variant={processingMode === 'bw' ? 'default' : 'outline'}
    size="sm"
    onClick={() => setProcessingMode('bw')}
  >
    📄 Document
  </Button>
  <Button
    variant={processingMode === 'color' ? 'default' : 'outline'}
    size="sm"
    onClick={() => setProcessingMode('color')}
  >
    🖼️ Color
  </Button>
</div>
```

---

## Part 5: High-Quality PDF Output

### Update `generateCombinedPDF` function

```typescript
const generateCombinedPDF = async (pages: CapturedPage[]): Promise<Blob> => {
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'in',
    format: 'letter',
    compress: true,
  });

  for (let i = 0; i < pages.length; i++) {
    if (i > 0) pdf.addPage();
    
    const dataUrl = await blobToDataURL(pages[i].blob);
    
    // Full page, edge-to-edge for scanned documents
    // Images are already perspective-corrected to 8.5x11 ratio
    pdf.addImage(dataUrl, 'JPEG', 0, 0, 8.5, 11, undefined, 'FAST');
  }

  return pdf.output('blob');
};
```

---

## Files to Create

| File | Purpose |
|------|---------|
| `src/utils/documentEdgeDetection.ts` | Edge detection & corner finding |
| `src/utils/documentEnhancement.ts` | Shadow removal, contrast, sharpening |

## Files to Modify

| File | Changes |
|------|---------|
| `src/components/documents/DocumentScannerDialog.tsx` | Add edge overlay, processing pipeline, mode toggle |

---

## Processing Quality Targets

| Metric | Target |
|--------|--------|
| Edge detection accuracy | >90% on well-lit documents |
| Shadow removal | Eliminates visible shadows from overhead lighting |
| Text clarity | Razor-sharp at 300 DPI equivalent |
| Processing time | <500ms per page on mobile |
| Output quality | Print-ready, indistinguishable from original |

---

## User Experience Flow

1. **Open Scanner** → Camera activates
2. **Position Document** → Green overlay automatically outlines detected edges
3. **Status Indicator** → "Document Detected" when confident
4. **Tap Capture** → Brief processing animation
5. **Review Thumbnail** → Shows enhanced, shadow-free result
6. **Add More Pages** → Repeat for multi-page documents
7. **Upload** → Combined into crisp, professional PDF

---

## Technical Notes

- **No external libraries needed** - Pure canvas operations
- **Mobile optimized** - Downsampled edge detection for performance
- **Fallback behavior** - If no edges detected, captures full frame (manual crop later)
- **B&W mode default** - Best for official documents like Notice of Commencement
- **Color mode available** - For photos or colored documents
