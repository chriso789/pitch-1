import { findUntraceableEntries, type PhotoIntelligenceReport } from './reportModel';

export function assertReportExportable(report: PhotoIntelligenceReport): void {
  if (!report.approval?.approvedBy.trim() || !report.approval.approvedAt) {
    throw new Error('Save an inspector-approved report version before exporting.');
  }
  const missing = findUntraceableEntries(report);
  if (missing.length) throw new Error(`Original evidence missing: ${missing.map((f) => f.findingRef).join(', ')}`);
  if (report.noDamageAreas.length && !report.noDamageFindings?.length) {
    throw new Error('Re-save this older report to include traceable no-damage evidence.');
  }
  for (const marker of report.siteOverview?.markers ?? []) {
    if (!marker.buildingLabel.trim() || !Number.isFinite(marker.x) || !Number.isFinite(marker.y) || marker.x < 0 || marker.x > 1 || marker.y < 0 || marker.y > 1) {
      throw new Error('Building markers must lie within the aerial photograph.');
    }
  }
}