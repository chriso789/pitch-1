import type { PageBox } from './types';

/** Minimal valid one-page PDF with the given CropBox/Rotate/UserUnit (MediaBox = CropBox). */
export function buildBoxPdf(box: PageBox): Uint8Array {
  const b = box.crop.map((n) => Number(n.toFixed(6))).join(' ');
  const uu = box.userUnit && box.userUnit !== 1 ? ` /UserUnit ${box.userUnit}` : '';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [${b}] /CropBox [${b}] /Rotate ${box.rotate || 0}${uu} >>`,
  ];
  let out = '%PDF-1.7\n';
  const offs: number[] = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offs) out += `${String(o).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}
