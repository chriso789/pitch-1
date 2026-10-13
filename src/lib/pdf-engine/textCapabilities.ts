import { PDFDocument, PDFDict, PDFName } from 'pdf-lib';

export interface FontCapability {
  resource: string;
  name: string;
  subset: boolean;
  embedded: boolean;
  complexEncoding: boolean;
}

/** Inspect source resources, not PDF.js aliases. No font reuse/edit capability is inferred. */
export async function inspectPageFonts(bytes: Uint8Array, pageIndex: number): Promise<FontCapability[]> {
  const doc = await PDFDocument.load(bytes.slice(), { updateMetadata: false });
  const page = doc.getPages()[pageIndex];
  if (!page) throw new Error('Page does not exist');
  const fonts = page.node.Resources()?.lookupMaybe(PDFName.of('Font'), PDFDict);
  if (!fonts) return [];
  return fonts.entries().flatMap(([key, value]) => {
    const font = doc.context.lookup(value);
    if (!(font instanceof PDFDict)) return [];
    const base = font.lookupMaybe(PDFName.of('BaseFont'), PDFName)?.decodeText() ?? key.decodeText();
    const subtype = font.lookupMaybe(PDFName.of('Subtype'), PDFName)?.decodeText();
    // Type0 descriptors live on descendant fonts. Flag them conservatively rather than guessing an encoding.
    const descriptor = font.lookupMaybe(PDFName.of('FontDescriptor'), PDFDict);
    return [{ resource: key.decodeText(), name: base, subset: /^[A-Z]{6}\+/.test(base),
      embedded: !!descriptor && ['FontFile', 'FontFile2', 'FontFile3'].some(k => descriptor.has(PDFName.of(k))),
      complexEncoding: subtype === 'Type0' || subtype === 'Type3' || font.get(PDFName.of('Encoding')) instanceof PDFDict }];
  });
}

export const TEXT_EDIT_GAP = 'Original text editing is unavailable: the installed engines cannot replace PDF text streams or reuse their original font encodings. No font will be substituted.';