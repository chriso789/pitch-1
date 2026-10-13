export interface Raster { data: Uint8ClampedArray; width: number; height: number }
export interface ChangeRegion { x: number; y: number; w: number; h: number; kind: 'added' | 'deleted' | 'modified'; pixels: number }
export interface DiffResult { overlay: Uint8ClampedArray; regions: ChangeRegion[]; changedRatio: number }

const lum = (d: Uint8ClampedArray, i: number) => 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];

/**
 * Raster comparison of two pages rendered at the same size (old = a, new = b).
 * Anti-aliasing noise is suppressed: a pixel only counts when its luminance differs by more
 * than `threshold` AND at least `minNeighbors` of its 8 neighbours also differ. Detected
 * changes are candidates for human review — never applied to quantities automatically.
 */
export function diffRasters(a: Raster, b: Raster, opts: { threshold?: number; minNeighbors?: number; dx?: number; dy?: number; minRegionPx?: number } = {}): DiffResult {
  const { threshold = 48, minNeighbors = 3, dx = 0, dy = 0, minRegionPx = 12 } = opts;
  const W = Math.min(a.width, b.width), H = Math.min(a.height, b.height);
  const sign = new Int8Array(W * H); // +1 ink added, -1 ink removed
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const ax = x - dx, ay = y - dy;
    const la = ax >= 0 && ay >= 0 && ax < a.width && ay < a.height ? lum(a.data, (ay * a.width + ax) * 4) : 255;
    const lb = lum(b.data, (y * b.width + x) * 4);
    const d = la - lb;
    if (Math.abs(d) > threshold) sign[y * W + x] = d > 0 ? 1 : -1;
  }
  const keep = new Int8Array(W * H);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x; if (!sign[i]) continue;
    let n = 0; for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) if ((ox || oy) && sign[i + oy * W + ox]) n++;
    if (n >= minNeighbors) keep[i] = sign[i];
  }
  const overlay = new Uint8ClampedArray(W * H * 4);
  let changed = 0;
  for (let i = 0; i < W * H; i++) if (keep[i]) { changed++; const o = i * 4; if (keep[i] > 0) { overlay[o + 1] = 160; } else { overlay[o] = 220; } overlay[o + 3] = 200; }
  // Group into regions on a coarse grid so nearby edits merge into one review item.
  const G = 16, gw = Math.ceil(W / G), gh = Math.ceil(H / G);
  const add = new Int32Array(gw * gh), del = new Int32Array(gw * gh);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const k = keep[y * W + x]; if (k) (k > 0 ? add : del)[((y / G) | 0) * gw + ((x / G) | 0)]++; }
  const seen = new Uint8Array(gw * gh), regions: ChangeRegion[] = [];
  for (let c = 0; c < gw * gh; c++) {
    if (seen[c] || add[c] + del[c] === 0) continue;
    let minX = gw, minY = gh, maxX = 0, maxY = 0, A = 0, D = 0; const st = [c]; seen[c] = 1;
    while (st.length) {
      const q = st.pop()!, qx = q % gw, qy = (q / gw) | 0; A += add[q]; D += del[q];
      minX = Math.min(minX, qx); maxX = Math.max(maxX, qx); minY = Math.min(minY, qy); maxY = Math.max(maxY, qy);
      for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const nx = qx + ox, ny = qy + oy; if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        const n = ny * gw + nx; if (!seen[n] && add[n] + del[n] > 0) { seen[n] = 1; st.push(n); }
      }
    }
    if (A + D < minRegionPx) continue;
    const kind = A && D ? (Math.min(A, D) / Math.max(A, D) > 0.2 ? 'modified' : A > D ? 'added' : 'deleted') : A ? 'added' : 'deleted';
    regions.push({ x: minX * G, y: minY * G, w: Math.min(W, (maxX + 1) * G) - minX * G, h: Math.min(H, (maxY + 1) * G) - minY * G, kind, pixels: A + D });
  }
  return { overlay, regions: regions.sort((p, q) => q.pixels - p.pixels), changedRatio: changed / (W * H) };
}

/** Plain-text revision report for review, RFIs or change-order discussion. */
export function revisionReport(meta: { oldName: string; newName: string; page: number }, regions: ChangeRegion[], size: { width: number; height: number }): string {
  const lines = [`Revision comparison — page ${meta.page}`, `Previous: ${meta.oldName}`, `Revised: ${meta.newName}`, `Detected change areas: ${regions.length} (require manual review; no quantities were changed)`, ''];
  regions.forEach((r, i) => lines.push(`${i + 1}. ${r.kind.toUpperCase()} at ${Math.round((r.x / size.width) * 100)}% from left, ${Math.round((r.y / size.height) * 100)}% from top (${Math.round((r.w / size.width) * 100)}% × ${Math.round((r.h / size.height) * 100)}% of sheet)`));
  return lines.join('\n');
}
