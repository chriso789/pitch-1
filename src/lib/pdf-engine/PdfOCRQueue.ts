/**
 * PITCH PDF OCR Queue
 * Manages OCR jobs for pages with missing/low text layers.
 */

export interface OcrJob {
  pageNumber: number;
  pageId: string;
  status: 'pending' | 'running' | 'done' | 'failed';
  result?: { wordCount: number; confidence: number };
  error?: string;
}

export class PdfOCRQueue {
  private jobs: OcrJob[] = [];
  private listeners: Array<(jobs: OcrJob[]) => void> = [];

  get allJobs() { return [...this.jobs]; }
  get pendingCount() { return this.jobs.filter(j => j.status === 'pending').length; }
  get completedCount() { return this.jobs.filter(j => j.status === 'done').length; }
  get totalCount() { return this.jobs.length; }
  get progress() { return this.totalCount ? this.completedCount / this.totalCount : 0; }

  addJob(pageNumber: number, pageId: string) {
    if (this.jobs.some(j => j.pageNumber === pageNumber)) return;
    this.jobs.push({ pageNumber, pageId, status: 'pending' });
    this.notify();
  }

  updateJob(pageNumber: number, update: Partial<OcrJob>) {
    const job = this.jobs.find(j => j.pageNumber === pageNumber);
    if (job) Object.assign(job, update);
    this.notify();
  }

  /**
   * Detect pages that need OCR based on extracted_text content.
   */
  static detectPagesNeedingOcr(
    pages: Array<{ page_number: number; id: string; extracted_text: string | null; metadata: Record<string, unknown> }>
  ): Array<{ pageNumber: number; pageId: string }> {
    return pages
      .filter(p => {
        if ((p.metadata as any)?.ocr_complete) return false;
        const text = p.extracted_text?.trim() || '';
        return text.length < 20; // Likely scanned
      })
      .map(p => ({ pageNumber: p.page_number, pageId: p.id }));
  }

  subscribe(fn: (jobs: OcrJob[]) => void) {
    this.listeners.push(fn);
    return () => { this.listeners = this.listeners.filter(l => l !== fn); };
  }

  private notify() {
    this.listeners.forEach(fn => fn(this.allJobs));
  }

  reset() {
    this.jobs = [];
    this.notify();
  }
}
