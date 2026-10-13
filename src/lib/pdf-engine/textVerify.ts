/**
 * Independent (second-engine) proof that a text edit changed only the edited text.
 * Viewers such as pdf.js split or merge text runs differently when spacing changes (e.g. a double
 * space can become two items), so the edited text is matched as a chain of items starting at its
 * own position, and every OTHER item must still exist with the same text at the same position.
 */
export type PlacedText = { str: string; x: number; y: number };

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
const strip = (s: string) => s.replace(/\s+/g, '');
const TOL = 0.05; // PDF points

export interface EditTarget {
  /** the original item (from `before`) that was edited */
  original: PlacedText;
  /** origin of the new text in PDF user space */
  x: number; y: number;
  /** unit baseline direction of the new text */
  dir: [number, number];
  size: number;
  text: string;
}

export function verifyOnlyEditedTextChanged(before: PlacedText[], after: PlacedText[], t: EditTarget): { ok: true } | { ok: false; reason: string } {
  const b = before.filter(i => norm(i.str));
  const a = after.filter(i => norm(i.str));
  // 1) remove the edited item from before
  const bi = b.findIndex(i => norm(i.str) === norm(t.original.str) && Math.abs(i.x - t.original.x) < TOL && Math.abs(i.y - t.original.y) < TOL);
  if (bi < 0) return { ok: false, reason: 'the selected text could not be located in the original page' };
  b.splice(bi, 1);

  // 2) find the new text in after: items on its baseline, from its origin forward, whose joined text equals the replacement
  const target = strip(t.text);
  const [ux, uy] = t.dir;
  const band = Math.max(1, t.size * 0.5);
  const line = a.map((i, k) => ({ i, k, along: (i.x - t.x) * ux + (i.y - t.y) * uy, across: -(i.x - t.x) * uy + (i.y - t.y) * ux }))
    .filter(p => p.along > -1 && Math.abs(p.across) < band)
    .sort((p, q) => p.along - q.along);
  const used = new Set<number>(); let acc = '';
  for (const p of line) {
    if (acc === target) break;
    const s = strip(p.i.str);
    if (!target.startsWith(acc + s)) { if (acc) break; continue; }
    acc += s; used.add(p.k);
  }
  if (acc !== target) return { ok: false, reason: 'the new text was not found where it was written' };
  const rest = a.filter((_, k) => !used.has(k));

  // 3) every other item must be unchanged, at the same place
  if (rest.length !== b.length) return { ok: false, reason: `${Math.abs(rest.length - b.length)} other text item(s) appeared or disappeared` };
  const left = [...rest];
  for (const i of b) {
    const k = left.findIndex(j => norm(j.str) === norm(i.str) && Math.abs(j.x - i.x) < TOL && Math.abs(j.y - i.y) < TOL);
    if (k < 0) return { ok: false, reason: `"${norm(i.str).slice(0, 40)}" moved or changed` };
    left.splice(k, 1);
  }
  return { ok: true };
}
