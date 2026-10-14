/** Compares comments/markups (PDF annotations) on one page between two versions. Read-only; never edits either file. */
import { PDFDocument, PDFArray, PDFDict, PDFName, PDFString, PDFHexString, PDFNumber } from 'pdf-lib';

export interface AnnotInfo { subtype: string; rect: [number, number, number, number]; contents: string; pitch: boolean }
export interface AnnotDiff { added: AnnotInfo[]; removed: AnnotInfo[]; changed: { before: AnnotInfo; after: AnnotInfo }[]; unchanged: number }

const SKIP = new Set(['Widget', 'Link', 'Popup']);
const str = (v: unknown) => v instanceof PDFString || v instanceof PDFHexString ? v.decodeText() : '';

export async function listAnnots(bytes: Uint8Array, pageIndex: number): Promise<AnnotInfo[]> {
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
  if (pageIndex < 0 || pageIndex >= doc.getPageCount()) return [];
  let arr: PDFArray | undefined;
  try { arr = doc.getPage(pageIndex).node.lookupMaybe(PDFName.of('Annots'), PDFArray); } catch { return []; }
  const out: AnnotInfo[] = [];
  for (const ref of arr?.asArray() ?? []) {
    let d: PDFDict | undefined;
    try { d = doc.context.lookupMaybe(ref, PDFDict); } catch { continue; }
    if (!d) continue;
    const subtype = d.lookupMaybe(PDFName.of('Subtype'), PDFName)?.decodeText() ?? 'Unknown';
    if (SKIP.has(subtype)) continue;
    const r = d.lookupMaybe(PDFName.of('Rect'), PDFArray)?.asArray().map(n => (n instanceof PDFNumber ? n.asNumber() : 0)) ?? [0, 0, 0, 0];
    const [a, b, c, e] = [r[0] ?? 0, r[1] ?? 0, r[2] ?? 0, r[3] ?? 0];
    out.push({ subtype, rect: [Math.min(a, c), Math.min(b, e), Math.max(a, c), Math.max(b, e)], contents: str(d.lookup(PDFName.of('Contents'))), pitch: d.has(PDFName.of('PITCHMarkup')) });
  }
  return out;
}

/** Same type and position (within tol points) = same annotation; differing text = changed. */
export function diffAnnots(before: AnnotInfo[], after: AnnotInfo[], tol = 2): AnnotDiff {
  const left = [...before], res: AnnotDiff = { added: [], removed: [], changed: [], unchanged: 0 };
  for (const b of after) {
    const i = left.findIndex(a => a.subtype === b.subtype && a.rect.every((v, k) => Math.abs(v - b.rect[k]) <= tol));
    if (i < 0) { res.added.push(b); continue; }
    const [a] = left.splice(i, 1);
    if (a.contents.trim() !== b.contents.trim()) res.changed.push({ before: a, after: b }); else res.unchanged++;
  }
  res.removed = left;
  return res;
}
