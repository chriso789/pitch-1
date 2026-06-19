// Lightweight per-session performance telemetry for the scanner.
// Stores only timings, counts, and sizes — never image data or customer text.
// Consumed by the diagnostics "copy" action and persisted into document metadata.

export interface ScannerTelemetryRecord {
  cameraStartupMs?: number;
  opencvLoadMs?: number;
  detectionAvgMs?: number;
  detectionSamples?: number;
  captureAvgMs?: number;
  captureSamples?: number;
  enhancementAvgMs?: number;
  enhancementSamples?: number;
  pdfBuildMs?: number;
  uploadMs?: number;
  totalPages?: number;
  finalFileBytes?: number;
  startedAt: number;
  finishedAt?: number;
}

export class ScannerTelemetry {
  private rec: ScannerTelemetryRecord = { startedAt: Date.now() };
  private rolling: Record<string, { sum: number; count: number }> = {};

  mark(key: 'cameraStartupMs' | 'opencvLoadMs' | 'pdfBuildMs' | 'uploadMs', ms: number) {
    this.rec[key] = Math.round(ms);
  }

  observe(key: 'detection' | 'capture' | 'enhancement', ms: number) {
    const slot = (this.rolling[key] ??= { sum: 0, count: 0 });
    slot.sum += ms;
    slot.count += 1;
    if (key === 'detection') {
      this.rec.detectionAvgMs = Math.round(slot.sum / slot.count);
      this.rec.detectionSamples = slot.count;
    } else if (key === 'capture') {
      this.rec.captureAvgMs = Math.round(slot.sum / slot.count);
      this.rec.captureSamples = slot.count;
    } else {
      this.rec.enhancementAvgMs = Math.round(slot.sum / slot.count);
      this.rec.enhancementSamples = slot.count;
    }
  }

  setPages(n: number) {
    this.rec.totalPages = n;
  }

  setFinalBytes(b: number) {
    this.rec.finalFileBytes = b;
  }

  finish() {
    this.rec.finishedAt = Date.now();
    return this.snapshot();
  }

  snapshot(): ScannerTelemetryRecord {
    return { ...this.rec };
  }

  /** Safe to copy to clipboard — pure JSON, no image data or PII. */
  toDiagnosticsText(extra: Record<string, unknown> = {}): string {
    return JSON.stringify({ telemetry: this.snapshot(), ...extra }, null, 2);
  }
}

export async function timeIt<T>(fn: () => Promise<T> | T): Promise<{ value: T; ms: number }> {
  const t0 = performance.now();
  const value = await fn();
  return { value, ms: performance.now() - t0 };
}
