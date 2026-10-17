/**
 * Photo Intelligence report composition (Phase 6).
 *
 * Builds the report data model from APPROVED findings and their evidence.
 * Hard rules (from the master plan):
 *  - Only human-approved findings appear in a customer report.
 *  - Every rendered finding links back to its finding id and original photo.
 *  - Areas inspected with no visible damage are recorded, not omitted.
 *  - Nothing invents quantities, specs, or age — unknowns render as such.
 */

import type { PhotoFinding, FindingEvidence } from './findings';
import type { Annotation } from './annotations';
import { parseAnnotationSet } from './annotations';

export interface ReportBranding {
  companyName: string;
  logoUrl?: string | null;
  primaryColor?: string | null;
  phone?: string | null;
  email?: string | null;
  licenseLine?: string | null;
}

export interface ReportProperty {
  address: string;
  inspectedAt: string; // ISO date
  inspectorName: string;
  reportTitle?: string;
}

export interface ReportFindingEntry {
  findingId: string;
  findingRef: string;
  buildingLabel: string;
  component: string;
  material: string | null;
  condition: string;
  description: string | null;
  severity: PhotoFinding['severity'];
  waterExposureConcern: boolean;
  limitations: string | null;
  recommendedVerification: string | null;
  /** Original-photo storage paths backing this finding (never annotated copies). */
  evidencePhotoPaths: string[];
  roofPlane?: string | null;
  detectionSource?: PhotoFinding['detection_source'];
  evidence?: { evidenceId: string; photoId: string | null; storagePath: string; source: FindingEvidence['annotation_source']; annotations: Annotation[] }[];
}

/** Locations are image-relative only, never geographic coordinates or quantities. */
export interface ReportSiteOverview {
  storagePath: string;
  attribution: string;
  markers: { buildingLabel: string; x: number; y: number }[];
}

export interface ReportBuildingSection {
  buildingLabel: string;
  findings: ReportFindingEntry[];
}

export interface PhotoIntelligenceReport {
  branding: ReportBranding;
  property: ReportProperty;
  generatedAt: string;
  executiveSummary: string;
  buildings: ReportBuildingSection[];
  noDamageAreas: string[];
  noDamageFindings?: ReportFindingEntry[];
  siteOverview?: ReportSiteOverview | null;
  priorityCounts: Record<PhotoFinding['severity'], number>;
  waterEntryConcerns: ReportFindingEntry[];
  limitations: string[];
  recommendedNextSteps: string[];
  /** Inspector approval is required before export; recorded here. */
  approval: { approvedBy: string; approvedAt: string } | null;
  version: number;
}

export const SEVERITY_ORDER: PhotoFinding['severity'][] = ['immediate', 'high', 'moderate', 'low', 'cosmetic', 'unknown'];

const NO_DAMAGE_CONDITION = /no visible damage/i;

/** True when a finding records an inspected area with no visible damage. */
export function isNoDamageFinding(f: PhotoFinding): boolean {
  return NO_DAMAGE_CONDITION.test(f.visible_condition) || NO_DAMAGE_CONDITION.test(f.condition_description ?? '');
}

/**
 * Compose the report model. Throws if any included finding is not approved —
 * the report must never carry unreviewed or rejected findings to a customer.
 */
export function composeReport(args: {
  branding: ReportBranding;
  property: ReportProperty;
  findings: PhotoFinding[];
  evidenceByFinding: Map<string, FindingEvidence[]>;
  approval?: { approvedBy: string; approvedAt: string } | null;
  version?: number;
  now?: string;
  siteOverview?: ReportSiteOverview | null;
}): PhotoIntelligenceReport {
  const { findings, evidenceByFinding } = args;

  const unapproved = findings.filter((f) => f.review_status !== 'approved');
  if (unapproved.length > 0) {
    throw new Error(
      `Report blocked: ${unapproved.length} finding(s) are not inspector-approved (${unapproved
        .map((f) => f.finding_ref)
        .slice(0, 5)
        .join(', ')}${unapproved.length > 5 ? '…' : ''})`,
    );
  }

  const toEntry = (f: PhotoFinding): ReportFindingEntry => ({
    findingId: f.id,
    findingRef: f.finding_ref,
    buildingLabel: f.building_label?.trim() || 'Unassigned building',
    component: f.component,
    material: f.material ?? null,
    condition: f.visible_condition,
    description: f.condition_description ?? null,
    severity: f.severity,
    roofPlane: f.roof_plane,
    detectionSource: f.detection_source,
    waterExposureConcern: f.water_exposure_concern,
    limitations: f.limitations ?? null,
    recommendedVerification: f.recommended_verification ?? null,
    evidencePhotoPaths: (evidenceByFinding.get(f.id) ?? [])
      .map((e) => e.storage_path)
      .filter((p): p is string => !!p),
    evidence: (evidenceByFinding.get(f.id) ?? []).filter((e) => !!e.storage_path).map((e) => ({
      evidenceId: e.id, photoId: e.photo_id, storagePath: e.storage_path ?? '',
      source: e.annotation_source, annotations: parseAnnotationSet(e.annotation),
    })),
  });

  const damage = findings.filter((f) => !isNoDamageFinding(f));
  const noDamage = findings.filter(isNoDamageFinding);

  const byBuilding = new Map<string, ReportFindingEntry[]>();
  for (const f of damage) {
    const e = toEntry(f);
    const arr = byBuilding.get(e.buildingLabel) ?? [];
    arr.push(e);
    byBuilding.set(e.buildingLabel, arr);
  }
  const buildings: ReportBuildingSection[] = [...byBuilding.entries()]
    .map(([buildingLabel, entries]) => ({
      buildingLabel,
      findings: entries.sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)),
    }))
    .sort((a, b) => a.buildingLabel.localeCompare(b.buildingLabel));

  const priorityCounts = Object.fromEntries(SEVERITY_ORDER.map((s) => [s, 0])) as Record<PhotoFinding['severity'], number>;
  for (const f of damage) priorityCounts[f.severity] += 1;

  const waterEntryConcerns = buildings.flatMap((b) => b.findings).filter((e) => e.waterExposureConcern);

  const limitations = [...new Set(findings.map((f) => f.limitations).filter((l): l is string => !!l))];

  const recommendedNextSteps: string[] = [];
  if (priorityCounts.immediate > 0) recommendedNextSteps.push('Address immediate-priority items before further weather exposure.');
  if (waterEntryConcerns.length > 0) recommendedNextSteps.push('Investigate potential water-entry points noted in this report.');
  const needsVerification = damage.filter((f) => f.recommended_verification);
  if (needsVerification.length > 0) recommendedNextSteps.push('Complete the recommended close-up or core verifications listed per finding.');
  if (noDamage.length > 0) recommendedNextSteps.push('Re-inspect documented no-damage areas after the next major weather event.');
  if (recommendedNextSteps.length === 0) recommendedNextSteps.push('No further action recommended at this time.');

  const executiveSummary = buildExecutiveSummary(args.property, damage, noDamage, priorityCounts, waterEntryConcerns.length);

  return {
    branding: args.branding,
    property: args.property,
    generatedAt: args.now ?? new Date().toISOString(),
    executiveSummary,
    buildings,
    noDamageAreas: noDamage.map((f) => `${f.building_label?.trim() || 'Unassigned building'} — ${f.component}: ${f.visible_condition}`),
    noDamageFindings: noDamage.map(toEntry),
    siteOverview: args.siteOverview ?? null,
    priorityCounts,
    waterEntryConcerns,
    limitations,
    recommendedNextSteps,
    approval: args.approval ?? null,
    version: args.version ?? 1,
  };
}

function buildExecutiveSummary(
  property: ReportProperty,
  damage: PhotoFinding[],
  noDamage: PhotoFinding[],
  counts: Record<PhotoFinding['severity'], number>,
  waterConcerns: number,
): string {
  const parts: string[] = [];
  parts.push(
    `Inspection of ${property.address} on ${property.inspectedAt.slice(0, 10)} documented ${damage.length} damage finding(s) across ${new Set(damage.map((f) => f.building_label?.trim() || 'Unassigned building')).size} building area(s).`,
  );
  const urgent = counts.immediate + counts.high;
  if (urgent > 0) parts.push(`${urgent} finding(s) are immediate or high priority.`);
  if (waterConcerns > 0) parts.push(`${waterConcerns} finding(s) raise potential water-entry concerns.`);
  if (noDamage.length > 0) parts.push(`${noDamage.length} inspected area(s) showed no visible damage and are documented for the record.`);
  parts.push('All findings in this report were reviewed and approved by the inspector.');
  return parts.join(' ');
}

/** Every finding entry must trace to at least one original photo. */
export function findUntraceableEntries(report: PhotoIntelligenceReport): ReportFindingEntry[] {
  return [...report.buildings.flatMap((b) => b.findings), ...(report.noDamageFindings ?? [])].filter((e) => e.evidencePhotoPaths.length === 0);
}
