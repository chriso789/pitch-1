/**
 * PITCH PDF Page Operation Engine
 * Handles page-level operations: reorder, duplicate, insert blank,
 * merge PDFs, split PDFs, and extract pages.
 */

import { PDFDocument, rgb } from 'pdf-lib';

export interface PageInfo {
  pageNumber: number;
  width: number;
  height: number;
  rotation: number;
}

export class PdfPageOperationEngine {
  /**
   * Reorder pages in a PDF.
   * @param newOrder Array of 1-based page numbers in desired order
   */
  static async reorderPages(
    pdfBytes: ArrayBuffer,
    newOrder: number[]
  ): Promise<Uint8Array> {
    const srcDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const newDoc = await PDFDocument.create();

    for (const pageNum of newOrder) {
      const idx = pageNum - 1;
      if (idx >= 0 && idx < srcDoc.getPageCount()) {
        const [copied] = await newDoc.copyPages(srcDoc, [idx]);
        newDoc.addPage(copied);
      }
    }

    return await newDoc.save();
  }

  /**
   * Duplicate a specific page.
   */
  static async duplicatePage(
    pdfBytes: ArrayBuffer,
    pageNumber: number
  ): Promise<Uint8Array> {
    const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const pageIdx = pageNumber - 1;

    if (pageIdx < 0 || pageIdx >= doc.getPageCount()) {
      throw new Error(`Invalid page number: ${pageNumber}`);
    }

    const [copied] = await doc.copyPages(doc, [pageIdx]);
    doc.insertPage(pageIdx + 1, copied);

    return await doc.save();
  }

  /**
   * Insert a blank page at a specific position.
   */
  static async insertBlankPage(
    pdfBytes: ArrayBuffer,
    afterPageNumber: number,
    width: number = 612,
    height: number = 792
  ): Promise<Uint8Array> {
    const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const page = doc.insertPage(afterPageNumber, [width, height]);

    // Optional: add a subtle border to indicate blank page
    page.drawRectangle({
      x: 36, y: 36,
      width: width - 72, height: height - 72,
      color: rgb(0.98, 0.98, 0.98),
      borderColor: rgb(0.9, 0.9, 0.9),
      borderWidth: 0.5,
    });

    return await doc.save();
  }

  /**
   * Remove a page from a PDF.
   */
  static async removePage(
    pdfBytes: ArrayBuffer,
    pageNumber: number
  ): Promise<Uint8Array> {
    const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const pageIdx = pageNumber - 1;

    if (pageIdx < 0 || pageIdx >= doc.getPageCount()) {
      throw new Error(`Invalid page number: ${pageNumber}`);
    }

    doc.removePage(pageIdx);
    return await doc.save();
  }

  /**
   * Merge multiple PDFs into one.
   */
  static async mergePdfs(
    pdfBytesArray: ArrayBuffer[]
  ): Promise<Uint8Array> {
    const mergedDoc = await PDFDocument.create();

    for (const bytes of pdfBytesArray) {
      const srcDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const pageIndices = srcDoc.getPageIndices();
      const copiedPages = await mergedDoc.copyPages(srcDoc, pageIndices);
      for (const page of copiedPages) {
        mergedDoc.addPage(page);
      }
    }

    return await mergedDoc.save();
  }

  /**
   * Split a PDF into individual page PDFs.
   */
  static async splitPages(
    pdfBytes: ArrayBuffer
  ): Promise<Uint8Array[]> {
    const srcDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const result: Uint8Array[] = [];

    for (let i = 0; i < srcDoc.getPageCount(); i++) {
      const newDoc = await PDFDocument.create();
      const [copied] = await newDoc.copyPages(srcDoc, [i]);
      newDoc.addPage(copied);
      result.push(await newDoc.save());
    }

    return result;
  }

  /**
   * Extract specific pages from a PDF.
   */
  static async extractPages(
    pdfBytes: ArrayBuffer,
    pageNumbers: number[]
  ): Promise<Uint8Array> {
    const srcDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const newDoc = await PDFDocument.create();

    const indices = pageNumbers.map(n => n - 1).filter(i => i >= 0 && i < srcDoc.getPageCount());
    const copiedPages = await srcDoc.copyPages(srcDoc, indices);

    for (const page of copiedPages) {
      newDoc.addPage(page);
    }

    return await newDoc.save();
  }

  /**
   * Get page information for all pages.
   */
  static async getPageInfo(pdfBytes: ArrayBuffer): Promise<PageInfo[]> {
    const doc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
    const pages = doc.getPages();

    return pages.map((page, i) => ({
      pageNumber: i + 1,
      width: page.getWidth(),
      height: page.getHeight(),
      rotation: page.getRotation().angle || 0,
    }));
  }
}
