import { assert, assertEquals } from "jsr:@std/assert@1";
import { PDFDocument, StandardFonts } from "npm:pdf-lib@1.17.1";
import { appendSignaturePage, isBoxOnPage, validateAnchor } from "./index.ts";

const size = () => ({ width: 612, height: 792 });

Deno.test("anchor with signature line below the page bottom is rejected", () => {
  // Real stored anchor from estimate OBR-00122: lines were clipped off page 4.
  const anchor = {
    pageIndex: 3, xPt: 41.96, yPt: -63.18, widthPt: 253.15,
    customerSig: { xPt: 41.96, yPt: -63.18, widthPt: 253.15 },
    companySig: { xPt: 316.89, yPt: -63.18, widthPt: 253.15 },
  };
  assertEquals(validateAnchor(anchor, 6, size), null);
});

Deno.test("anchor is rejected when only the company line is off page", () => {
  const anchor = {
    pageIndex: 3, xPt: 41.96, yPt: 221.6, widthPt: 253.15,
    customerSig: { xPt: 41.96, yPt: 221.6, widthPt: 253.15 },
    companySig: { xPt: 316.89, yPt: -5, widthPt: 253.15 },
  };
  assertEquals(validateAnchor(anchor, 6, size), null);
});

Deno.test("anchor on a page that does not exist is rejected", () => {
  const box = { xPt: 41.96, yPt: 221.6, widthPt: 253.15 };
  assertEquals(validateAnchor({ pageIndex: 6, ...box, customerSig: box }, 6, size), null);
});

Deno.test("visible customer and company lines are accepted", () => {
  const anchor = {
    pageIndex: 3, xPt: 41.96, yPt: 221.6, widthPt: 253.15,
    customerSig: { xPt: 41.96, yPt: 221.6, widthPt: 253.15 },
    companySig: { xPt: 316.89, yPt: 221.6, widthPt: 253.15 },
  };
  assert(validateAnchor(anchor, 6, size));
});

Deno.test("appended signature page has both lines on the new last page", async () => {
  const pdf = await PDFDocument.create();
  pdf.addPage([612, 792]);
  const fonts = { regular: await pdf.embedFont(StandardFonts.Helvetica), bold: await pdf.embedFont(StandardFonts.HelveticaBold) };
  const anchor = appendSignaturePage(pdf, fonts, { title: "Standing seam", reference: "OBR-00122", totalText: "$12,500.00" });
  assertEquals(pdf.getPageCount(), 2);
  assertEquals(anchor.pageIndex, 1);
  assert(isBoxOnPage(anchor.customerSig, 612, 792));
  assert(isBoxOnPage(anchor.companySig, 612, 792));
  assert(anchor.companySig!.xPt > anchor.customerSig!.xPt + anchor.customerSig!.widthPt);
  assert(validateAnchor(anchor, 2, size));
});
