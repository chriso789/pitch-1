import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { generatePhotoReportPdf } from '@/lib/photo-intelligence/reportPdf';
import { assertReportExportable } from '@/lib/photo-intelligence/reportExportGuard';
import type { PhotoIntelligenceReport } from '@/lib/photo-intelligence/reportModel';

const entry = { findingId: 'finding-1', findingRef: 'F-001', buildingLabel: 'Building A', component: 'Shingles', material: null, condition: 'Missing tabs', description: null, severity: 'high' as const, waterExposureConcern: true, limitations: null, recommendedVerification: null, evidencePhotoPaths: ['tenant/photos/original.png'], detectionSource: 'reference_label' as const,
  evidence: [{ evidenceId: 'evidence-1', photoId: 'photo-1', storagePath: 'tenant/photos/original.png', source: 'reference_label' as const, annotations: [{ id: 'ann-1', kind: 'bbox' as const, origin: { x: 0.2, y: 0.2 }, size: { x: 0.4, y: 0.3 }, color: '', label: 1 }] }] };
const report: PhotoIntelligenceReport = { branding: { companyName: 'PITCH — QA fixture' }, property: { address: 'Synthetic test property — not Navarre', inspectedAt: '2026-10-17', inspectorName: 'QA fixture' }, generatedAt: '2026-10-17', executiveSummary: 'Résumé: inspector-reviewed synthetic test evidence.', buildings: [{ buildingLabel: 'Building A', findings: [entry] }], noDamageAreas: [], noDamageFindings: [], priorityCounts: { immediate: 0, high: 1, moderate: 0, low: 0, cosmetic: 0, unknown: 0 }, waterEntryConcerns: [entry], limitations: ['Synthetic fixture only — no real damage assessment.'], recommendedNextSteps: ['Obtain close-up evidence before a repair scope.'], approval: { approvedBy: 'Inspector QA', approvedAt: '2026-10-17' }, version: 7, siteOverview: { storagePath: 'tenant/photos/original.png', attribution: 'Synthetic QA image', markers: [{ buildingLabel: 'Building A', x: 0.5, y: 0.4 }] } };
describe('programmatic report export gates', () => {
  it('blocks drafts even when an older approved version exists elsewhere', () => { expect(() => assertReportExportable({ ...report, approval: null })).toThrow(/approved/); });
  it('blocks untraceable original evidence, including no-damage findings', () => {
    expect(() => assertReportExportable({ ...report, noDamageFindings: [{ ...entry, findingRef: 'CLEAR-1', evidencePhotoPaths: [] }] })).toThrow(/CLEAR-1/);
  });
  it('rejects invented/out-of-image building locations', () => { expect(() => assertReportExportable({ ...report, siteOverview: { ...report.siteOverview, storagePath: 'x', attribution: 'x', markers: [{ buildingLabel: 'A', x: 2, y: 0.2 }] } })).toThrow(/within/); });
  it('creates a reopenable, paginated PDF from an immutable approved version', async () => {
    const fontPath = process.env.PHOTO_REPORT_TEST_FONT ?? 'tests/fixtures/photo-report/DejaVuSans-subset.ttf';
    const pngPath = process.env.PHOTO_REPORT_TEST_IMAGE;
    const png = pngPath ? new Uint8Array(readFileSync(pngPath)) : new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1sAAAAASUVORK5CYII=', 'base64'));
    const before = JSON.stringify(report);
    const bytes = await generatePhotoReportPdf(report, { fontBytes: new Uint8Array(readFileSync(fontPath)), resolveImage: async () => png });
    const reopened = await PDFDocument.load(bytes);
    expect(reopened.getPageCount()).toBeGreaterThanOrEqual(6);
    expect(reopened.getAuthor()).toBe('PITCH — QA fixture');
    expect(reopened.getSubject()).toContain('Approved version 7');
    expect(JSON.stringify(report)).toBe(before);
    if (process.env.PHOTO_REPORT_QA_OUTPUT) writeFileSync(process.env.PHOTO_REPORT_QA_OUTPUT, bytes);
  });
});