// Commercial roofing estimate engine: takeoff drivers x assembly components -> lines & totals.
export type Driver = 'roof_area' | 'perimeter' | 'parapet' | 'drains' | 'scuppers' | 'curbs' | 'penetrations' | 'flashing';

export const DRIVERS: { key: Driver; label: string; uom: string }[] = [
  { key: 'roof_area', label: 'Roof area', uom: 'SF' },
  { key: 'perimeter', label: 'Perimeter / edge', uom: 'LF' },
  { key: 'parapet', label: 'Parapet wall', uom: 'LF' },
  { key: 'flashing', label: 'Flashing', uom: 'LF' },
  { key: 'drains', label: 'Roof drains', uom: 'EA' },
  { key: 'scuppers', label: 'Scuppers', uom: 'EA' },
  { key: 'curbs', label: 'Curbs / RTUs', uom: 'EA' },
  { key: 'penetrations', label: 'Penetrations', uom: 'EA' },
];

export const REVIEW_STATUSES = ['auto_detected', 'review_required', 'verified', 'manually_overridden', 'rejected'] as const;
export const USABLE = new Set(['verified', 'manually_overridden']);

export interface Qty { id: string; driver: string; value: number; review_status: string }
export interface Component { name: string; kind: string; driver: string; qty_per_driver: number; uom: string; unit_cost: number; waste_pct: number; crew_rate_per_day?: number | null; crew_day_cost?: number | null }

export function driverTotals(qtys: Qty[], includeUnreviewed = true) {
  const t: Record<string, { value: number; ids: string[] }> = {};
  for (const q of qtys) {
    if (q.review_status === 'rejected') continue;
    if (!includeUnreviewed && !USABLE.has(q.review_status)) continue;
    t[q.driver] ??= { value: 0, ids: [] };
    t[q.driver].value += Number(q.value) || 0;
    t[q.driver].ids.push(q.id);
  }
  return t;
}

export function buildLines(qtys: Qty[], comps: Component[]) {
  const totals = driverTotals(qtys);
  return comps.map((c, i) => {
    const base = totals[c.driver]?.value ?? 0;
    let quantity = base * Number(c.qty_per_driver) * (1 + Number(c.waste_pct) / 100);
    let unit_cost = Number(c.unit_cost);
    if (c.kind === 'labor' && c.crew_rate_per_day && c.crew_day_cost) {
      // crew rate is driver-units per day
      quantity = base / Number(c.crew_rate_per_day);
      unit_cost = Number(c.crew_day_cost);
    }
    quantity = Math.round(quantity * 100) / 100;
    return { kind: c.kind, description: c.name, quantity, uom: c.kind === 'labor' && c.crew_rate_per_day ? 'crew-day' : c.uom, unit_cost, total: Math.round(quantity * unit_cost * 100) / 100, sort_order: i };
  });
}

export function computeTotals(lines: { kind: string; total: number }[], e: { general_conditions: number; overhead_pct: number; profit_pct: number; bond_pct: number; tax_pct: number }) {
  const sum = (k: string) => lines.filter((l) => l.kind === k).reduce((a, l) => a + Number(l.total), 0);
  const material = sum('material'), labor = sum('labor'), equipment = sum('equipment'), sub = sum('subcontract');
  const tax = material * (Number(e.tax_pct) / 100);
  const direct = material + labor + equipment + sub + tax + Number(e.general_conditions || 0);
  const overhead = direct * (Number(e.overhead_pct) / 100);
  const profit = (direct + overhead) * (Number(e.profit_pct) / 100);
  const bond = (direct + overhead + profit) * (Number(e.bond_pct) / 100);
  const bid = direct + overhead + profit + bond;
  const r = (n: number) => Math.round(n * 100) / 100;
  return { material: r(material), labor: r(labor), equipment: r(equipment), sub: r(sub), tax: r(tax), direct: r(direct), overhead: r(overhead), profit: r(profit), bond: r(bond), bid: r(bid) };
}

export const money = (n: number) => (Number(n) || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

// Starter commercial roofing assemblies (editable per tenant)
export const STARTER_ASSEMBLIES: { name: string; system_type: string; components: Component[] }[] = [
  { name: '60 mil TPO – Mechanically Attached', system_type: 'TPO', components: [
    { name: '60 mil TPO membrane', kind: 'material', driver: 'roof_area', qty_per_driver: 1, uom: 'SF', unit_cost: 0.95, waste_pct: 10 },
    { name: 'Polyiso insulation 2.6" (R-15)', kind: 'material', driver: 'roof_area', qty_per_driver: 1, uom: 'SF', unit_cost: 1.1, waste_pct: 5 },
    { name: '1/2" HD cover board', kind: 'material', driver: 'roof_area', qty_per_driver: 1, uom: 'SF', unit_cost: 0.65, waste_pct: 5 },
    { name: 'Fasteners & plates', kind: 'material', driver: 'roof_area', qty_per_driver: 1, uom: 'SF', unit_cost: 0.22, waste_pct: 0 },
    { name: 'Edge metal / drip edge', kind: 'material', driver: 'perimeter', qty_per_driver: 1, uom: 'LF', unit_cost: 6.5, waste_pct: 5 },
    { name: 'Parapet flashing & coping', kind: 'material', driver: 'parapet', qty_per_driver: 1, uom: 'LF', unit_cost: 14, waste_pct: 5 },
    { name: 'Roof drain retrofit', kind: 'material', driver: 'drains', qty_per_driver: 1, uom: 'EA', unit_cost: 185, waste_pct: 0 },
    { name: 'Pipe boots / penetrations', kind: 'material', driver: 'penetrations', qty_per_driver: 1, uom: 'EA', unit_cost: 35, waste_pct: 0 },
    { name: 'Curb flashing', kind: 'material', driver: 'curbs', qty_per_driver: 1, uom: 'EA', unit_cost: 120, waste_pct: 0 },
    { name: 'Field install crew (5-man)', kind: 'labor', driver: 'roof_area', qty_per_driver: 1, uom: 'SF', unit_cost: 0, waste_pct: 0, crew_rate_per_day: 2500, crew_day_cost: 2800 },
    { name: 'Flashing/detail crew', kind: 'labor', driver: 'parapet', qty_per_driver: 1, uom: 'LF', unit_cost: 0, waste_pct: 0, crew_rate_per_day: 200, crew_day_cost: 1400 },
  ]},
  { name: '60 mil EPDM – Fully Adhered', system_type: 'EPDM', components: [
    { name: '60 mil EPDM membrane', kind: 'material', driver: 'roof_area', qty_per_driver: 1, uom: 'SF', unit_cost: 1.05, waste_pct: 10 },
    { name: 'Bonding adhesive', kind: 'material', driver: 'roof_area', qty_per_driver: 1, uom: 'SF', unit_cost: 0.35, waste_pct: 5 },
    { name: 'Polyiso insulation 2.6"', kind: 'material', driver: 'roof_area', qty_per_driver: 1, uom: 'SF', unit_cost: 1.1, waste_pct: 5 },
    { name: 'Edge metal', kind: 'material', driver: 'perimeter', qty_per_driver: 1, uom: 'LF', unit_cost: 6.5, waste_pct: 5 },
    { name: 'Install crew', kind: 'labor', driver: 'roof_area', qty_per_driver: 1, uom: 'SF', unit_cost: 0, waste_pct: 0, crew_rate_per_day: 2000, crew_day_cost: 2800 },
  ]},
  { name: 'Mod-Bit 2-Ply – Torch/Self-Adhered', system_type: 'Mod-Bit', components: [
    { name: 'SBS base sheet', kind: 'material', driver: 'roof_area', qty_per_driver: 1, uom: 'SF', unit_cost: 0.55, waste_pct: 10 },
    { name: 'SBS granulated cap sheet', kind: 'material', driver: 'roof_area', qty_per_driver: 1, uom: 'SF', unit_cost: 0.75, waste_pct: 10 },
    { name: 'Cover board', kind: 'material', driver: 'roof_area', qty_per_driver: 1, uom: 'SF', unit_cost: 0.65, waste_pct: 5 },
    { name: 'Edge metal', kind: 'material', driver: 'perimeter', qty_per_driver: 1, uom: 'LF', unit_cost: 6.5, waste_pct: 5 },
    { name: 'Install crew', kind: 'labor', driver: 'roof_area', qty_per_driver: 1, uom: 'SF', unit_cost: 0, waste_pct: 0, crew_rate_per_day: 1800, crew_day_cost: 2800 },
  ]},
  { name: '24ga Standing Seam Metal', system_type: 'Metal', components: [
    { name: '24ga SSMR panels', kind: 'material', driver: 'roof_area', qty_per_driver: 1, uom: 'SF', unit_cost: 5.25, waste_pct: 8 },
    { name: 'High-temp underlayment', kind: 'material', driver: 'roof_area', qty_per_driver: 1, uom: 'SF', unit_cost: 0.45, waste_pct: 10 },
    { name: 'Trim & flashing', kind: 'material', driver: 'perimeter', qty_per_driver: 1, uom: 'LF', unit_cost: 9, waste_pct: 5 },
    { name: 'Panel install crew', kind: 'labor', driver: 'roof_area', qty_per_driver: 1, uom: 'SF', unit_cost: 0, waste_pct: 0, crew_rate_per_day: 1200, crew_day_cost: 2800 },
  ]},
];

export function autoReviewStatus(confidence: number | null, scale: string) {
  if (confidence == null) return 'review_required';
  return confidence >= 95 && scale === 'verified' ? 'auto_detected' : 'review_required';
}

// Very small CSV parser (handles quoted fields)
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []; let cur: string[] = []; let f = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { f += '"'; i++; } else if (c === '"') q = false; else f += c; }
    else if (c === '"') q = true;
    else if (c === ',') { cur.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; cur.push(f); rows.push(cur); cur = []; f = ''; }
    else f += c;
  }
  if (f || cur.length) { cur.push(f); rows.push(cur); }
  const [h, ...rest] = rows.filter((r) => r.some((x) => x.trim()));
  if (!h) return [];
  const headers = h.map((x) => x.trim().toLowerCase());
  return rest.map((r) => Object.fromEntries(headers.map((k, i) => [k, (r[i] ?? '').trim()])));
}

export function pick(row: Record<string, string>, ...keys: string[]) {
  for (const k of keys) { const hit = Object.keys(row).find((h) => h.includes(k)); if (hit && row[hit]) return row[hit]; }
  return '';
}

export function guessDriver(label: string, uom: string): Driver {
  const s = `${label} ${uom}`.toLowerCase();
  if (/drain/.test(s)) return 'drains';
  if (/scupper/.test(s)) return 'scuppers';
  if (/curb|rtu|hvac/.test(s)) return 'curbs';
  if (/pipe|penetrat|vent|boot/.test(s)) return 'penetrations';
  if (/parapet|coping/.test(s)) return 'parapet';
  if (/flash/.test(s)) return 'flashing';
  if (/edge|perimeter|gutter|lf\b/.test(s)) return 'perimeter';
  return 'roof_area';
}
