/**
 * Phase 2C — compare saved plan measurements between two drawing versions (one sheet).
 * Read-only: never changes measurements, takeoffs, estimates or budgets.
 * Points are PDF user space, so identical geometry means the same points within a tolerance.
 */
export interface MeasureRow { id: string; kind: string; points: [number, number][]; value: number; unit: string; label: string | null; status: string; scale_id: string | null }
export type MeasureChange =
  | { type: 'added'; after: MeasureRow }
  | { type: 'removed'; before: MeasureRow }
  | { type: 'value_changed'; before: MeasureRow; after: MeasureRow }
  | { type: 'reshaped'; before: MeasureRow; after: MeasureRow }
  | { type: 'unchanged'; before: MeasureRow; after: MeasureRow };

const TOL = 0.5; // PDF points
export function sameGeometry(a: MeasureRow, b: MeasureRow) {
  if (a.kind !== b.kind || a.points.length !== b.points.length) return false;
  return a.points.every((p, i) => Math.abs(p[0] - b.points[i][0]) <= TOL && Math.abs(p[1] - b.points[i][1]) <= TOL);
}
const sameValue = (a: MeasureRow, b: MeasureRow) => a.unit === b.unit && Math.abs(a.value - b.value) <= Math.max(1e-6, Math.abs(a.value) * 1e-6);

export function diffMeasurements(before: MeasureRow[], after: MeasureRow[]): MeasureChange[] {
  const out: MeasureChange[] = [];
  const left = before.filter(m => m.status !== 'rejected');
  const right = after.filter(m => m.status !== 'rejected');
  const used = new Set<number>();
  const pending: MeasureRow[] = [];
  for (const b of left) {
    const i = right.findIndex((a, j) => !used.has(j) && sameGeometry(b, a));
    if (i < 0) { pending.push(b); continue; }
    used.add(i);
    out.push(sameValue(b, right[i]) ? { type: 'unchanged', before: b, after: right[i] } : { type: 'value_changed', before: b, after: right[i] });
  }
  for (const b of pending) {
    const i = b.label ? right.findIndex((a, j) => !used.has(j) && a.kind === b.kind && a.label === b.label) : -1;
    if (i >= 0) { used.add(i); out.push({ type: 'reshaped', before: b, after: right[i] }); }
    else out.push({ type: 'removed', before: b });
  }
  right.forEach((a, j) => { if (!used.has(j)) out.push({ type: 'added', after: a }); });
  return out;
}
