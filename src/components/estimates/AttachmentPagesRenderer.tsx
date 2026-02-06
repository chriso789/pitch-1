/**
 * AttachmentPagesRenderer - Renders PDF attachments as visual pages in the estimate preview
 * 
 * Fetches PDFs from Supabase Storage, converts each page to an image using PDF.js,
 * and displays them as letter-sized preview pages.
 */
import React, { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { loadPDFFromArrayBuffer, renderPageToDataUrl, type RenderedPage } from '@/lib/pdfRenderer';
import { resolveStorageBucket } from '@/lib/documents/resolveStorageBucket';
import { Loader2, FileWarning } from 'lucide-react';

// Letter size at 96 DPI (same as EstimatePDFDocument)
const PAGE_WIDTH = 816;
const PAGE_HEIGHT = 1056;

interface TemplateAttachment {
  document_id: string;
  file_path: string;
  filename: string;
  attachment_order: number;
}

interface AttachmentPagesRendererProps {
  attachments: TemplateAttachment[];
}

interface AttachmentPage extends RenderedPage {
  attachmentFilename: string;
  pageNumber: number;
  totalPages: number;
}

export function AttachmentPagesRenderer({ attachments }: AttachmentPagesRendererProps) {
  const [pages, setPages] = useState<AttachmentPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    if (!attachments || attachments.length === 0) {
      setLoading(false);
      return;
    }

    async function loadAllAttachmentPages() {
      const allPages: AttachmentPage[] = [];
      const loadErrors: string[] = [];

      for (const att of attachments) {
        try {
          console.log('[AttachmentPagesRenderer] Fetching:', att.filename, 'from path:', att.file_path);
          
          // Resolve the correct bucket based on file path
          const bucket = resolveStorageBucket('company_resource', att.file_path);
          console.log('[AttachmentPagesRenderer] Using bucket:', bucket);
          
          // Download the PDF from storage
          const { data: blob, error } = await supabase.storage
            .from(bucket)
            .download(att.file_path);

          if (error || !blob) {
            console.error('[AttachmentPagesRenderer] Download error:', error);
            loadErrors.push(`Failed to fetch ${att.filename}`);
            continue;
          }

          // Convert blob to ArrayBuffer
          const arrayBuffer = await blob.arrayBuffer();
          console.log('[AttachmentPagesRenderer] Downloaded:', att.filename, 'size:', arrayBuffer.byteLength);

          // Load PDF with PDF.js
          const pdf = await loadPDFFromArrayBuffer(arrayBuffer);
          console.log('[AttachmentPagesRenderer] PDF loaded:', att.filename, 'pages:', pdf.numPages);

          // Render each page to a data URL
          for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
            const rendered = await renderPageToDataUrl(pdf, pageNum, 2); // Scale 2 for crisp rendering
            allPages.push({
              ...rendered,
              attachmentFilename: att.filename,
              pageNumber: pageNum,
              totalPages: pdf.numPages,
            });
          }

          // Cleanup
          pdf.destroy();
        } catch (err) {
          console.error('[AttachmentPagesRenderer] Error processing:', att.filename, err);
          loadErrors.push(`Error loading ${att.filename}`);
        }
      }

      setPages(allPages);
      setErrors(loadErrors);
      setLoading(false);
    }

    loadAllAttachmentPages();
  }, [attachments]);

  // Loading state
  if (loading) {
    return (
      <div
        data-report-page
        className="bg-white flex flex-col items-center justify-center"
        style={{
          width: `${PAGE_WIDTH}px`,
          minHeight: `${PAGE_HEIGHT}px`,
          maxHeight: `${PAGE_HEIGHT}px`,
        }}
      >
        <Loader2 className="h-12 w-12 animate-spin text-muted-foreground mb-4" />
        <p className="text-muted-foreground text-sm">Loading attachments...</p>
      </div>
    );
  }

  // No pages to render
  if (pages.length === 0 && errors.length === 0) {
    return null;
  }

  return (
    <>
      {/* Render each attachment page as a full page */}
      {pages.map((page, idx) => (
        <div
          key={`attachment-page-${idx}`}
          data-report-page
          className="bg-white flex flex-col"
          style={{
            width: `${PAGE_WIDTH}px`,
            minHeight: `${PAGE_HEIGHT}px`,
            maxHeight: `${PAGE_HEIGHT}px`,
            overflow: 'hidden',
          }}
        >
          <img
            src={page.dataUrl}
            alt={`${page.attachmentFilename} - Page ${page.pageNumber}`}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
            }}
          />
        </div>
      ))}

      {/* Show errors if any attachments failed */}
      {errors.length > 0 && (
        <div
          data-report-page
          className="bg-white flex flex-col items-center justify-center p-8"
          style={{
            width: `${PAGE_WIDTH}px`,
            minHeight: `${PAGE_HEIGHT}px`,
            maxHeight: `${PAGE_HEIGHT}px`,
          }}
        >
          <FileWarning className="h-12 w-12 text-amber-500 mb-4" />
          <p className="text-amber-700 font-medium mb-2">Some attachments could not be loaded:</p>
          <ul className="text-sm text-muted-foreground">
            {errors.map((err, i) => (
              <li key={i}>• {err}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

export default AttachmentPagesRenderer;
