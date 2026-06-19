// Content-aware edge-cleanup decision: skip inward inset if dark ink
// (signature/stamp) lives close to the page edge, otherwise apply the preset inset.

export interface EdgeAnalysisResult {
  applyInset: boolean;
  reason: 'ink-near-edge' | 'clean-edge';
  inkRatioNearEdge: number;
}

export function analyzeEdgeForInset(canvas: HTMLCanvasElement): EdgeAnalysisResult {
  try {
    const ctx = canvas.getContext('2d');
    if (!ctx) return { applyInset: true, reason: 'clean-edge', inkRatioNearEdge: 0 };
    const w = canvas.width;
    const h = canvas.height;
    // Sample a 1.2% border band on each side.
    const bandPx = Math.max(8, Math.round(Math.min(w, h) * 0.012));
    const samples: number[] = [];
    const stride = 4; // pixel stride for speed
    const rowsTop = ctx.getImageData(0, 0, w, bandPx).data;
    const rowsBot = ctx.getImageData(0, h - bandPx, w, bandPx).data;
    const colsL = ctx.getImageData(0, 0, bandPx, h).data;
    const colsR = ctx.getImageData(w - bandPx, 0, bandPx, h).data;
    const sources = [rowsTop, rowsBot, colsL, colsR];
    let darkCount = 0;
    let total = 0;
    for (const buf of sources) {
      for (let i = 0; i < buf.length; i += 4 * stride) {
        const g = 0.299 * buf[i] + 0.587 * buf[i + 1] + 0.114 * buf[i + 2];
        if (g < 90) darkCount++;
        total++;
        samples.push(g);
      }
    }
    const ratio = total ? darkCount / total : 0;
    // If >4% of edge pixels are darkly inked, skip cleanup to preserve signatures.
    if (ratio > 0.04) {
      return { applyInset: false, reason: 'ink-near-edge', inkRatioNearEdge: ratio };
    }
    return { applyInset: true, reason: 'clean-edge', inkRatioNearEdge: ratio };
  } catch {
    return { applyInset: true, reason: 'clean-edge', inkRatioNearEdge: 0 };
  }
}
