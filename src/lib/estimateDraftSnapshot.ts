/**
 * Local recovery snapshot for the estimate builder.
 *
 * The server-side auto-draft needs a couple of network round trips, so work
 * started seconds before a browser refresh (or while editing an existing
 * estimate) could be lost. This keeps a synchronous copy in localStorage that
 * is written on every change and flushed on unload, then offered back when the
 * builder mounts again.
 */

const PREFIX = 'pitch_estimate_snapshot_v1';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface EstimateSnapshot {
  propertyDetails: any;
  lineItems: any[];
  excelConfig: any;
  templateId: string | null;
  salesRepId: string | null;
  secondaryRepIds: string[];
  editingEstimateId: string | null;
  ts: number;
}

const keyFor = (pipelineEntryId: string, editingEstimateId?: string | null) =>
  `${PREFIX}:${pipelineEntryId}:${editingEstimateId || 'new'}`;

export function saveEstimateSnapshot(
  pipelineEntryId: string,
  snapshot: Omit<EstimateSnapshot, 'ts'>
): void {
  if (typeof window === 'undefined' || !pipelineEntryId) return;
  try {
    localStorage.setItem(
      keyFor(pipelineEntryId, snapshot.editingEstimateId),
      JSON.stringify({ ...snapshot, ts: Date.now() })
    );
  } catch {
    /* storage full or unavailable – recovery is best effort */
  }
}

/** Most recent non-expired snapshot for this lead/job, across new + edit slots. */
export function readLatestEstimateSnapshot(
  pipelineEntryId: string
): EstimateSnapshot | null {
  if (typeof window === 'undefined' || !pipelineEntryId) return null;
  let best: EstimateSnapshot | null = null;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(`${PREFIX}:${pipelineEntryId}:`)) continue;
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as EstimateSnapshot;
      if (!parsed?.ts || Date.now() - parsed.ts > MAX_AGE_MS) {
        localStorage.removeItem(k);
        continue;
      }
      if (!best || parsed.ts > best.ts) best = parsed;
    }
  } catch {
    return best;
  }
  return best;
}

export function clearEstimateSnapshots(pipelineEntryId: string): void {
  if (typeof window === 'undefined' || !pipelineEntryId) return;
  try {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(`${PREFIX}:${pipelineEntryId}:`)) doomed.push(k);
    }
    doomed.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}

export function snapshotHasContent(s: EstimateSnapshot | null): boolean {
  if (!s) return false;
  const hasLines = Array.isArray(s.lineItems)
    ? s.lineItems.some((i: any) => (i?.item_name || '').trim())
    : false;
  const pd = s.propertyDetails || {};
  return (
    hasLines ||
    (pd.customer_name || '').trim().length > 0 ||
    (pd.customer_address || '').trim().length > 0 ||
    (pd.roof_area_sq_ft || 0) > 0
  );
}
