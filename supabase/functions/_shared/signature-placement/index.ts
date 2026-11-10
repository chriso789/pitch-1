// Signature placement for signed estimate PDFs.
//
// A stored signature anchor is only trusted when every signature/date line it
// describes is visibly inside the PDF page. Older estimates could clip the
// signature block below the page, which used to make the server guess a spot
// over the fine print. Instead, an invalid anchor now produces a dedicated
// signature page with real customer and company lines.
import { PDFDocument, PDFFont, PDFPage, rgb } from "npm:pdf-lib@1.17.1";

export type Box = { xPt: number; yPt: number; widthPt: number };
export type SignatureAnchor = {
  pageIndex: number;
  xPt: number;
  yPt: number;
  widthPt: number;
  pageWidthPt?: number;
  pageHeightPt?: number;
  customerSig?: Box;
  customerDate?: Box;
  companySig?: Box;
  companyDate?: Box;
  appendedSignaturePage?: boolean;
};

const BOTTOM_MARGIN = 20;
const TOP_MARGIN = 10;

export function isBoxOnPage(box: Box | undefined | null, pageW: number, pageH: number): boolean {
  if (!box) return false;
  const values = [box.xPt, box.yPt, box.widthPt];
  if (!values.every((v) => typeof v === "number" && Number.isFinite(v))) return false;
  return box.widthPt > 20 &&
    box.xPt >= 0 &&
    box.xPt + box.widthPt <= pageW + 1 &&
    box.yPt > BOTTOM_MARGIN &&
    box.yPt < pageH - TOP_MARGIN;
}

/** Returns the anchor only when its page exists and every described line is on that page. */
export function validateAnchor(
  anchor: SignatureAnchor | null | undefined,
  pageCount: number,
  pageSize: (index: number) => { width: number; height: number },
): SignatureAnchor | null {
  if (!anchor || typeof anchor !== "object") return null;
  if (!Number.isInteger(anchor.pageIndex) || anchor.pageIndex < 0 || anchor.pageIndex >= pageCount) return null;
  const { width, height } = pageSize(anchor.pageIndex);
  const customerSig = anchor.customerSig ?? { xPt: anchor.xPt, yPt: anchor.yPt, widthPt: anchor.widthPt };
  if (!isBoxOnPage(customerSig, width, height)) return null;
  for (const optional of [anchor.customerDate, anchor.companySig, anchor.companyDate]) {
    if (optional && !isBoxOnPage(optional, width, height)) return null;
  }
  return { ...anchor, customerSig };
}

export function anchorFromStored(value: unknown): SignatureAnchor | null {
  return value && typeof value === "object" ? value as SignatureAnchor : null;
}

/** Layout of the dedicated signature page in PDF points (exported for tests). */
export function signaturePageLayout(pageW: number, pageH: number) {
  const margin = 54;
  const gap = 36;
  const colW = (pageW - margin * 2 - gap) / 2;
  const sigY = pageH - 330;
  const dateY = sigY - 40;
  const dateOffset = 30;
  return {
    customerSig: { xPt: margin, yPt: sigY, widthPt: colW },
    customerDate: { xPt: margin + dateOffset, yPt: dateY, widthPt: colW - dateOffset },
    companySig: { xPt: margin + colW + gap, yPt: sigY, widthPt: colW },
    companyDate: { xPt: margin + colW + gap + dateOffset, yPt: dateY, widthPt: colW - dateOffset },
  };
}

/**
 * Adds a signature page that references the agreement, shows the total being
 * signed for, and prints customer and company signature/date lines.
 */
export function appendSignaturePage(
  pdfDoc: PDFDocument,
  fonts: { regular: PDFFont; bold: PDFFont },
  info: { title?: string | null; reference?: string | null; totalText?: string | null; companyName?: string | null },
): SignatureAnchor {
  const first = pdfDoc.getPageCount() > 0 ? pdfDoc.getPage(0).getSize() : { width: 612, height: 792 };
  const page = pdfDoc.addPage([first.width, first.height]);
  const { width: pageW, height: pageH } = page.getSize();
  const layout = signaturePageLayout(pageW, pageH);
  const gray = rgb(0.42, 0.45, 0.5);
  const dark = rgb(0.07, 0.09, 0.15);
  const line = rgb(0.55, 0.55, 0.55);
  const margin = layout.customerSig.xPt;

  page.drawText("Signature Page", { x: margin, y: pageH - 80, size: 18, font: fonts.bold, color: dark });
  const subject = [info.title, info.reference ? `#${info.reference}` : null].filter(Boolean).join("  •  ");
  if (subject) page.drawText(subject.slice(0, 90), { x: margin, y: pageH - 104, size: 11, font: fonts.regular, color: gray });
  page.drawText(
    "By signing below, both parties accept the estimate, pricing and terms on the preceding pages.",
    { x: margin, y: pageH - 140, size: 10, font: fonts.regular, color: dark },
  );
  if (info.totalText) {
    page.drawRectangle({ x: margin, y: pageH - 205, width: pageW - margin * 2, height: 40, color: rgb(0.94, 0.96, 1) });
    page.drawText("Total Investment (signing for)", { x: margin + 12, y: pageH - 190, size: 11, font: fonts.bold, color: dark });
    const w = fonts.bold.widthOfTextAtSize(info.totalText, 14);
    page.drawText(info.totalText, { x: pageW - margin - 12 - w, y: pageH - 191, size: 14, font: fonts.bold, color: rgb(0.15, 0.39, 0.92) });
  }

  const drawColumn = (label: string, sig: Box, date: Box) => {
    page.drawText(label, { x: sig.xPt, y: sig.yPt + 70, size: 9, font: fonts.regular, color: gray });
    page.drawLine({ start: { x: sig.xPt, y: sig.yPt }, end: { x: sig.xPt + sig.widthPt, y: sig.yPt }, thickness: 0.6, color: line });
    page.drawText("Date:", { x: sig.xPt, y: date.yPt + 2, size: 9, font: fonts.regular, color: gray });
    page.drawLine({ start: { x: date.xPt, y: date.yPt }, end: { x: date.xPt + date.widthPt, y: date.yPt }, thickness: 0.5, color: line });
  };
  drawColumn("Customer Signature", layout.customerSig, layout.customerDate);
  drawColumn(info.companyName ? `Company Representative — ${info.companyName}`.slice(0, 60) : "Company Representative", layout.companySig, layout.companyDate);

  return {
    pageIndex: pdfDoc.getPageCount() - 1,
    xPt: layout.customerSig.xPt,
    yPt: layout.customerSig.yPt,
    widthPt: layout.customerSig.widthPt,
    pageWidthPt: pageW,
    pageHeightPt: pageH,
    ...layout,
    appendedSignaturePage: true,
  };
}

export async function embedSignatureImage(pdfDoc: PDFDocument, bytes: Uint8Array, preferPng = true) {
  try {
    return preferPng ? await pdfDoc.embedPng(bytes) : await pdfDoc.embedJpg(bytes);
  } catch {
    return preferPng ? await pdfDoc.embedJpg(bytes) : await pdfDoc.embedPng(bytes);
  }
}

export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.split(",")[1] || "";
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Stamps a signature (image or typed), date and audit line onto the given line boxes. */
export function stampSignature(
  page: PDFPage,
  fonts: { regular: PDFFont; bold: PDFFont },
  target: { sig: Box; date: Box | null },
  content: { image?: Awaited<ReturnType<typeof embedSignatureImage>>; typed?: string; dateText: string; auditText: string },
) {
  const { sig, date } = target;
  const gapToDate = date ? sig.yPt - date.yPt - 6 : 60;
  const maxH = Math.max(28, Math.min(60, gapToDate));
  const lineColor = rgb(0.55, 0.55, 0.55);

  if (content.image) {
    const dims = content.image.scale(1);
    const scale = Math.min(sig.widthPt / dims.width, maxH / dims.height);
    const w = dims.width * scale;
    const h = dims.height * scale;
    page.drawRectangle({ x: sig.xPt, y: sig.yPt + 1, width: sig.widthPt, height: h + 2, color: rgb(1, 1, 1) });
    page.drawImage(content.image, { x: sig.xPt, y: sig.yPt + 1, width: w, height: h });
  } else if (content.typed) {
    page.drawRectangle({ x: sig.xPt, y: sig.yPt + 1, width: sig.widthPt, height: 20, color: rgb(1, 1, 1) });
    page.drawText(content.typed.slice(0, 60), { x: sig.xPt + 2, y: sig.yPt + 4, size: 16, font: fonts.bold, color: rgb(0, 0, 0.4) });
  }
  page.drawLine({ start: { x: sig.xPt, y: sig.yPt }, end: { x: sig.xPt + sig.widthPt, y: sig.yPt }, thickness: 0.6, color: lineColor });

  if (date) {
    page.drawRectangle({ x: date.xPt, y: date.yPt + 1, width: date.widthPt, height: 14, color: rgb(1, 1, 1) });
    page.drawText(content.dateText, { x: date.xPt + 2, y: date.yPt + 2, size: 10, font: fonts.regular, color: rgb(0, 0, 0) });
    page.drawLine({ start: { x: date.xPt, y: date.yPt }, end: { x: date.xPt + date.widthPt, y: date.yPt }, thickness: 0.5, color: lineColor });
  }
  const auditY = (date ? date.yPt : sig.yPt) - 12;
  page.drawText(content.auditText, { x: sig.xPt, y: auditY, size: content.auditText.length > 56 ? 5 : 6, font: fonts.regular, color: lineColor });
}

export function formatUsd(value: unknown): string | null {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
