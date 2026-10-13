import { PDFDocument, StandardFonts, rgb, degrees } from 'pdf-lib';

/** Positions are fractions (0–1) of the visible page, measured from the top-left corner. */
export interface SignPlacement {
  id: string;
  page: number; // 0-based
  kind: 'signature' | 'initials' | 'text' | 'date' | 'check';
  x: number; y: number; w: number; h: number;
  png?: Uint8Array; // signature / initials image
  text?: string;    // text / date
}

/**
 * Visual Fill & Sign. Signatures are placed as images on the page — this is an electronic
 * signature mark, NOT a cryptographic (certificate) PDF signature. Existing page content,
 * form fields and annotations are left untouched; output is verified after reopening.
 */
export async function applyFillSign(bytes: Uint8Array, items: SignPlacement[]): Promise<Uint8Array> {
  if (!items.length) throw new Error('Nothing placed yet');
  const doc = await PDFDocument.load(bytes.slice(), { updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  const fieldCount = doc.getForm().getFields().length;
  for (const it of items) {
    const page = pages[it.page];
    if (!page) throw new Error(`Page ${it.page + 1} does not exist`);
    const rot = ((page.getRotation().angle % 360) + 360) % 360;
    const box = page.getCropBox();
    // Visible width/height swap for 90/270 rotated pages.
    const vw = rot % 180 ? box.height : box.width, vh = rot % 180 ? box.width : box.height;
    const w = it.w * vw, h = it.h * vh;
    const vx = it.x * vw, vy = vh - it.y * vh - h; // bottom-left in visible space
    // Map visible-space bottom-left to unrotated user space.
    let x = box.x + vx, y = box.y + vy, r = 0;
    if (rot === 90) { x = box.x + box.width - vy; y = box.y + vx; r = 90; }
    else if (rot === 180) { x = box.x + box.width - vx; y = box.y + box.height - vy; r = 180; }
    else if (rot === 270) { x = box.x + vy; y = box.y + box.height - vx; r = 270; }
    const rotate = degrees(r);
    if ((it.kind === 'signature' || it.kind === 'initials')) {
      if (!it.png) throw new Error('Signature image missing');
      const img = await doc.embedPng(it.png);
      page.drawImage(img, { x, y, width: w, height: h, rotate });
    } else if (it.kind === 'check') {
      const s = Math.min(w, h);
      page.drawText('X', { x, y, size: s, font, color: rgb(0, 0, 0), rotate });
    } else {
      const text = it.text ?? '';
      try { font.encodeText(text); } catch { throw new Error(`"${text}" contains characters the standard font can't show. Nothing was saved.`); }
      const size = Math.max(6, Math.min(h * 0.8, 24));
      page.drawText(text, { x, y: y + (r ? 0 : (h - size) / 2), size, font, color: rgb(0, 0, 0), rotate });
    }
  }
  const out = await doc.save();
  const check = await PDFDocument.load(out, { updateMetadata: false });
  if (check.getPageCount() !== pages.length) throw new Error('Verification failed: page count changed');
  if (check.getForm().getFields().length !== fieldCount) throw new Error('Verification failed: form fields changed');
  return out;
}

/** Render typed text as a signature-style PNG (image mark, not a certificate signature). */
export function typedSignaturePng(text: string, initials = false): Promise<Uint8Array> {
  const c = document.createElement('canvas');
  c.width = initials ? 240 : 600; c.height = 160;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#0a1f5c';
  ctx.font = `italic 72px "Brush Script MT", "Segoe Script", cursive`;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 12, 85, c.width - 24);
  return canvasPng(c);
}

export function canvasPng(c: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((res, rej) => c.toBlob(b => b ? b.arrayBuffer().then(a => res(new Uint8Array(a))) : rej(new Error('Could not capture signature')), 'image/png'));
}
