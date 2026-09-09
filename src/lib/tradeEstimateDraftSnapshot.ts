/**
 * Local recovery snapshot for the multi-trade estimate builder (Build Estimate).
 *
 * An estimate only becomes a database row when the user clicks Save, so any
 * unexpected refresh/timeout before that point used to lose everything. This
 * keeps a synchronous copy in localStorage, written on every change and on
 * unload, and offers it back when the builder mounts again.
 */

const PREFIX = 'pitch_trade_estimate_snapshot_v1';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface TradeEstimateSnapshot {
  tradeSections: any[];
  tradeLineItems: Record<string, any[]>;
  lineItems: any[];
  config: any;
  fixedPrice: number | null;
  selectedTemplateId: string;
  estimateDisplayName: string;
  estimatePricingTier: string;
  existingEstimateId: string | null;
  ts: number;
}

const keyFor = (pipelineEntryId: string, existingEstimateId?: string | null) =>
  `${PREFIX}:${pipelineEntryId}:${existingEstimateId || 'new'}`;

export function saveTradeEstimateSnapshot(
  pipelineEntryId: string,
  snapshot: Omit<TradeEstimateSnapshot, 'ts'>
): void {
  if (typeof window === 'undefined' || !pipelineEntryId) return;
  try {
    localStorage.setItem(
      keyFor(pipelineEntryId, snapshot.existingEstimateId),
      JSON.stringify({ ...snapshot, ts: Date.now() })
    );
  } catch {
    /* storage full or unavailable – recovery is best effort */
  }
}

export function readLatestTradeEstimateSnapshot(
  pipelineEntryId: string
): TradeEstimateSnapshot | null {
  if (typeof window === 'undefined' || !pipelineEntryId) return null;
  let best: TradeEstimateSnapshot | null = null;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(`${PREFIX}:${pipelineEntryId}:`)) continue;
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as TradeEstimateSnapshot;
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

export function clearTradeEstimateSnapshots(pipelineEntryId: string): void {
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

export function tradeSnapshotHasContent(
  s: TradeEstimateSnapshot | null
): boolean {
  if (!s) return false;
  const hasLines = Array.isArray(s.lineItems) && s.lineItems.length > 0;
  const hasTemplate =
    Boolean(s.selectedTemplateId) ||
    (Array.isArray(s.tradeSections) &&
      s.tradeSections.some((t: any) => !!t?.templateId));
  return hasLines || hasTemplate;
}
