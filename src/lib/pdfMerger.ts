 import { PDFDocument } from 'pdf-lib';
 
 /**
  * Merges the estimate PDF with attachment PDFs (e.g., product flyers).
  * Attachments are appended to the end of the estimate PDF.
  * 
  * @param estimatePdfBlob - The base estimate PDF as a Blob
  * @param attachmentUrls - Array of URLs pointing to attachment PDFs
  * @returns Merged PDF as a Blob
  */
 export async function mergeEstimateWithAttachments(
   estimatePdfBlob: Blob,
   attachmentUrls: string[]
 ): Promise<Blob> {
   // Load the base estimate PDF
   const estimateBytes = await estimatePdfBlob.arrayBuffer();
   const mergedPdf = await PDFDocument.load(estimateBytes);
   
   console.log(`[pdfMerger] Starting merge with ${attachmentUrls.length} attachments`);
   
   // Fetch and merge each attachment
   for (const url of attachmentUrls) {
     try {
       console.log(`[pdfMerger] Fetching attachment: ${url}`);
       const response = await fetch(url);
       
       if (!response.ok) {
         console.error(`[pdfMerger] Failed to fetch attachment (${response.status}): ${url}`);
         continue;
       }
       
       const attachmentBytes = await response.arrayBuffer();
       const attachmentPdf = await PDFDocument.load(attachmentBytes);
       
       // Copy all pages from attachment
       const pages = await mergedPdf.copyPages(
         attachmentPdf,
         attachmentPdf.getPageIndices()
       );
       
       pages.forEach(page => mergedPdf.addPage(page));
       console.log(`[pdfMerger] Added ${pages.length} pages from attachment`);
     } catch (err) {
       console.error('[pdfMerger] Failed to merge attachment:', url, err);
     }
   }
   
   // Return merged PDF as blob
   const mergedBytes = await mergedPdf.save();
   console.log(`[pdfMerger] Merge complete. Final PDF size: ${mergedBytes.byteLength} bytes`);
   
   // Convert Uint8Array to ArrayBuffer for Blob compatibility
   const arrayBuffer = mergedBytes.buffer.slice(
     mergedBytes.byteOffset,
     mergedBytes.byteOffset + mergedBytes.byteLength
   ) as ArrayBuffer;
   
   return new Blob([arrayBuffer], { type: 'application/pdf' });
 }