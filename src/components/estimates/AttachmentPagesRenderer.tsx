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

// Cache for downloaded PDF ArrayBuffers (persists across re-renders to prevent duplicate downloads)
const downloadCache = new Map<string, ArrayBuffer>();

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
  documentId: string;
  attachmentFilename: string;
  pageNumber: number;
  totalPages: number;
}

export function AttachmentPagesRenderer({ attachments }: AttachmentPagesRendererProps) {
  const [pages, setPages] = useState<AttachmentPage[]>([]);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<string[]>([]);

  useEffect(() => {
    // Reset state immediately when attachments change to prevent stale data
    setPages([]);
    setErrors([]);
    setLoading(true);
    
    if (!attachments || attachments.length === 0) {
      setLoading(false);
      return;
    }

    // Create abort controller to prevent race conditions
    const abortController = new AbortController();
    let isAborted = false;

    async function loadAllAttachmentPages() {
      const allPages: AttachmentPage[] = [];
      const loadErrors: string[] = [];

      for (const att of attachments) {
        // Check if aborted before processing each attachment
        if (isAborted) {
          console.log('[AttachmentPagesRenderer] Loading aborted, stopping');
          return;
        }
        
        try {
          console.log('[AttachmentPagesRenderer] Attachment data:', {
            document_id: att.document_id,
            filename: att.filename,
            file_path: att.file_path,
          });
          
          // Resolve the correct bucket based on file path
          const bucket = resolveStorageBucket('company_resource', att.file_path);
          console.log('[AttachmentPagesRenderer] Using bucket:', bucket);
          
          // Check download cache first to prevent duplicate downloads
          const cacheKey = `${att.document_id}:${att.file_path}`;
          let arrayBuffer = downloadCache.get(cacheKey);

          if (!arrayBuffer) {
            // Download the PDF from storage (not cached)
            console.log('[AttachmentPagesRenderer] Downloading:', att.filename);
            const { data: blob, error } = await supabase.storage
              .from(bucket)
              .download(att.file_path);

            if (isAborted) return;

            if (error || !blob) {
              console.error('[AttachmentPagesRenderer] Download error:', error);
              loadErrors.push(`Failed to fetch ${att.filename}`);
              continue;
            }

            // Convert blob to ArrayBuffer and cache it
            arrayBuffer = await blob.arrayBuffer();
            downloadCache.set(cacheKey, arrayBuffer);
            console.log('[AttachmentPagesRenderer] Downloaded & cached:', att.filename, 'size:', arrayBuffer.byteLength);
          } else {
            console.log('[AttachmentPagesRenderer] Using cached:', att.filename);
          }

          if (isAborted) return;

          // Load PDF with PDF.js - clone buffer to prevent detaching the cached original
          const pdf = await loadPDFFromArrayBuffer(arrayBuffer.slice(0));
          console.log('[AttachmentPagesRenderer] PDF loaded:', att.filename, 'pages:', pdf.numPages);

          // Render each page to a data URL, passing document_id for cache isolation
          for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
            if (isAborted) {
              pdf.destroy();
              return;
            }
            // Pass document_id as pdfId to ensure each PDF's pages are cached separately
            // Use JPEG at 0.70 quality and 1.0 scale for aggressive file size reduction
            const rendered = await renderPageToDataUrl(pdf, pageNum, 1.0, att.document_id, true, 0.70);
            allPages.push({
              ...rendered,
              documentId: att.document_id,
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

      // Only update state if not aborted
      if (!isAborted) {
        setPages(allPages);
        setErrors(loadErrors);
        setLoading(false);
      }
    }

    loadAllAttachmentPages();

    // Cleanup function to abort on unmount or attachment change
    return () => {
      isAborted = true;
      abortController.abort();
    };
  }, [attachments]);

  // Loading state - NO data-report-page so it won't be captured as a PDF page
  if (loading) {
    return (
      <div
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
          key={`attachment-${page.documentId}-page-${page.pageNumber}`}
          data-report-page
          className="bg-white flex flex-col"
          style={{
            width: `${PAGE_WIDTH}px`,
            minHeight: `${PAGE_HEIGHT}px`,
            maxHeight: `${PAGE_HEIGHT}px`,
            overflow: 'hidden',
            fontSize: 0,
            lineHeight: 0,
          }}
        >
          <img
            src={page.dataUrl}
            alt={`${page.attachmentFilename} - Page ${page.pageNumber}`}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'contain',
              display: 'block',
            }}
            draggable={false}
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
