import React, { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Download, ZoomIn, ZoomOut, ChevronLeft, ChevronRight, FileText, Loader2, AlertCircle, ExternalLink, Printer, Share2, Check } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { resolveStorageBucket } from '@/lib/documents/resolveStorageBucket';
import { loadPDFFromArrayBuffer, renderPageToDataUrl, PDFDocumentProxy, RenderedPage, clearPageCache } from '@/lib/pdfRenderer';
import { ShareDocumentDialog } from './ShareDocumentDialog';

interface Document {
  id: string;
  filename: string;
  file_path: string;
  mime_type: string | null;
  document_type?: string | null;
}

interface DocumentPreviewModalProps {
  document: Document | null;
  documents?: Document[];
  isOpen: boolean;
  onClose: () => void;
  onDownload: (doc: Document) => void;
}

export const DocumentPreviewModal: React.FC<DocumentPreviewModalProps> = ({
  document,
  documents = [],
  isOpen,
  onClose,
  onDownload,
}) => {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [textContent, setTextContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [copied, setCopied] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);


  // PDF.js state — render ALL pages and let the user scroll
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [pdfNumPages, setPdfNumPages] = useState(0);
  const [pdfRenderedPages, setPdfRenderedPages] = useState<RenderedPage[]>([]);
  const [pdfScale, setPdfScale] = useState(1.5);
  const [pdfLoading, setPdfLoading] = useState(false);
  const currentDoc = documents.length > 0 ? documents[currentIndex] : document;

  useEffect(() => {
    if (document && documents.length > 0) {
      const idx = documents.findIndex(d => d.id === document.id);
      if (idx >= 0) setCurrentIndex(idx);
    }
  }, [document, documents]);

  // Cleanup PDF on unmount or document change
  // Using ref to track pdfDoc to avoid stale closure issues
  const pdfDocRef = React.useRef<PDFDocumentProxy | null>(null);
  
  React.useEffect(() => {
    pdfDocRef.current = pdfDoc;
  }, [pdfDoc]);
  
  const cleanupPdf = useCallback(() => {
    const docToCleanup = pdfDocRef.current;
    if (docToCleanup) {
      try {
        docToCleanup.destroy();
      } catch (e) {
        console.warn('[PDF] Cleanup error:', e);
      }
    }
    pdfDocRef.current = null;
    setPdfDoc(null);
    setPdfNumPages(0);
    setPdfRenderedPages([]);
    clearPageCache();
  }, []);

  const getAuthorizedStorageUrl = useCallback(async (doc: Document) => {
    const bucket = resolveStorageBucket(doc.document_type, doc.file_path);
    const { data, error } = await supabase.functions.invoke('get-document-access-url', {
      body: { document_id: doc.id, expires_in: 3600 },
    });

    if (error) {
      throw new Error(error.message || 'Unable to create a secure document link');
    }

    const signedUrl = (data as { signedUrl?: string; path?: string; bucket?: string; error?: string } | null)?.signedUrl;
    if (!signedUrl) {
      throw new Error((data as { error?: string } | null)?.error || 'Unable to create a secure document link');
    }

    return {
      url: signedUrl,
      bucket: (data as { bucket?: string } | null)?.bucket || bucket,
      path: (data as { path?: string } | null)?.path || doc.file_path,
    };
  }, []);

  // Re-render all pages when scale changes
  useEffect(() => {
    if (!pdfDoc || pdfNumPages < 1) return;
    let cancelled = false;

    const renderAll = async () => {
      setPdfLoading(true);
      try {
        const pages: RenderedPage[] = [];
        for (let i = 1; i <= pdfNumPages; i++) {
          const rendered = await renderPageToDataUrl(pdfDoc, i, pdfScale);
          if (cancelled) return;
          pages.push(rendered);
          // Progressive display
          setPdfRenderedPages([...pages]);
        }
      } catch (error) {
        console.error('[PDF] Error rendering pages:', error);
      } finally {
        if (!cancelled) setPdfLoading(false);
      }
    };

    renderAll();
    return () => { cancelled = true; };
  }, [pdfDoc, pdfNumPages, pdfScale]);

  useEffect(() => {
    // Clear previous state immediately when document changes
    if (!currentDoc || !isOpen) {
      setPreviewUrl(null);
      setTextContent(null);
      setLoadError(null);
      cleanupPdf();
      return;
    }

    // Cleanup previous PDF before loading new one
    cleanupPdf();
    
    const loadPreview = async () => {
      setLoading(true);
      setTextContent(null);
      setLoadError(null);
      setZoom(1);

      const isExternal = currentDoc.file_path.startsWith('http') || currentDoc.file_path.startsWith('data:');
      
      if (isExternal) {
        setPreviewUrl(currentDoc.file_path);
        setLoading(false);
        return;
      }

      try {
        const authorized = await getAuthorizedStorageUrl(currentDoc);
        const mimeType = currentDoc.mime_type || '';
        const filename = currentDoc.filename.toLowerCase();
        const isPDF = mimeType === 'application/pdf' || filename.endsWith('.pdf');
        
        // For PDFs, download and render with PDF.js to avoid iframe blocking
        if (isPDF) {
          const response = await fetch(authorized.url);
          if (!response.ok) throw new Error('Unable to download the PDF for preview');

          const arrayBuffer = await response.arrayBuffer();
          console.log('[PDF] Loading PDF with PDF.js...');
          const pdf = await loadPDFFromArrayBuffer(arrayBuffer);
          
          setPdfDoc(pdf);
          setPdfNumPages(pdf.numPages);
          setPdfScale(1.5);
          setPdfRenderedPages([]);
          setPreviewUrl(authorized.url);
        } else if (mimeType.startsWith('text/') || 
            mimeType === 'application/json' ||
            currentDoc.filename.match(/\.(txt|csv|json|md|log)$/i)) {
          // Text files - download and display content
          const response = await fetch(authorized.url);
          if (!response.ok) throw new Error('Unable to download the document for preview');
          const text = await response.text();
          setTextContent(text);
          setPreviewUrl(null);
        } else {
          setPreviewUrl(authorized.url);
        }
      } catch (error) {
        console.error('Error loading preview:', error);
        setLoadError(error instanceof Error ? error.message : 'Failed to load document');
        setPreviewUrl(null);
      } finally {
        setLoading(false);
      }
    };

    loadPreview();

    return () => {
      if (previewUrl && !previewUrl.startsWith('http') && !previewUrl.startsWith('data:')) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [currentDoc?.id, isOpen, cleanupPdf, getAuthorizedStorageUrl]);

  // Open document in new tab using public or signed URL
  const openInNewTab = async () => {
    if (!currentDoc) return;
    
    // If we have a stored preview URL for PDFs, use it
    if (previewUrl && previewUrl.startsWith('http')) {
      window.open(previewUrl, '_blank');
      return;
    }

    const { url } = await getAuthorizedStorageUrl(currentDoc);
    window.open(url, '_blank');
  };

  const getDocUrl = async (): Promise<string | null> => {
    if (!currentDoc) return null;
    if (previewUrl && previewUrl.startsWith('http')) return previewUrl;
    const { url } = await getAuthorizedStorageUrl(currentDoc);
    return url;
  };

  const handlePrint = async () => {
    const url = await getDocUrl();
    if (!url) return;
    const win = window.open(url, '_blank');
    if (!win) return;
    const tryPrint = () => {
      try { win.focus(); win.print(); } catch { /* noop */ }
    };
    win.addEventListener('load', tryPrint);
    // Fallback in case load already fired
    setTimeout(tryPrint, 1500);
  };

  const handleShare = () => {
    if (!currentDoc) return;
    setShareOpen(true);
  };


  const getPreviewType = (): 'image' | 'pdf' | 'text' | 'unsupported' => {
    if (!currentDoc) return 'unsupported';
    
    const mimeType = currentDoc.mime_type || '';
    const filename = currentDoc.filename.toLowerCase();

    if (mimeType.startsWith('image/') || filename.match(/\.(jpg|jpeg|png|gif|webp|svg)$/)) {
      return 'image';
    }
    if (mimeType === 'application/pdf' || filename.endsWith('.pdf')) {
      return 'pdf';
    }
    if (textContent !== null || mimeType.startsWith('text/') || 
        mimeType === 'application/json' ||
        filename.match(/\.(txt|csv|json|md|log)$/)) {
      return 'text';
    }
    return 'unsupported';
  };

  const handlePrev = () => {
    if (currentIndex > 0) setCurrentIndex(currentIndex - 1);
  };

  const handleNext = () => {
    if (currentIndex < documents.length - 1) setCurrentIndex(currentIndex + 1);
  };

  // PDF zoom
  const handlePdfZoomIn = () => {
    setPdfScale(s => Math.min(3, s + 0.25));
  };

  const handlePdfZoomOut = () => {
    setPdfScale(s => Math.max(0.5, s - 0.25));
  };

  const previewType = getPreviewType();
  const showNavigation = documents.length > 1;
  const isPdfReady = pdfDoc && pdfRenderedPages.length > 0;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <div className="flex items-center justify-between">
            <DialogTitle className="truncate pr-4">
              {currentDoc?.filename || 'Document Preview'}
            </DialogTitle>
            <div className="flex items-center gap-2">
              {previewType === 'image' && (
                <>
                  <Button size="icon" variant="ghost" onClick={() => setZoom(z => Math.max(0.5, z - 0.25))}>
                    <ZoomOut className="h-4 w-4" />
                  </Button>
                  <span className="text-sm text-muted-foreground w-12 text-center">{Math.round(zoom * 100)}%</span>
                  <Button size="icon" variant="ghost" onClick={() => setZoom(z => Math.min(3, z + 0.25))}>
                    <ZoomIn className="h-4 w-4" />
                  </Button>
                </>
              )}
              {previewType === 'pdf' && isPdfReady && (
                <>
                  <Button size="icon" variant="ghost" onClick={handlePdfZoomOut} title="Zoom out">
                    <ZoomOut className="h-4 w-4" />
                  </Button>
                  <span className="text-sm text-muted-foreground w-12 text-center">{Math.round(pdfScale * 100 / 1.5)}%</span>
                  <Button size="icon" variant="ghost" onClick={handlePdfZoomIn} title="Zoom in">
                    <ZoomIn className="h-4 w-4" />
                  </Button>
                </>
              )}
              {currentDoc && (
                <Button size="sm" variant="outline" onClick={handlePrint}>
                  <Printer className="h-4 w-4 mr-2" />
                  Print
                </Button>
              )}
              {currentDoc && (
                <Button size="sm" variant="outline" onClick={() => onDownload(currentDoc)}>
                  <Download className="h-4 w-4 mr-2" />
                  Download
                </Button>
              )}
              {currentDoc && (
                <Button size="sm" variant="outline" onClick={handleShare}>
                  {copied ? (
                    <Check className="h-4 w-4 mr-2 text-green-600" />
                  ) : (
                    <Share2 className="h-4 w-4 mr-2" />
                  )}
                  {copied ? 'Copied!' : 'Share'}
                </Button>
              )}
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-auto min-h-0 bg-muted/30 rounded-lg relative">
          {loading ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : loadError ? (
            <div className="flex flex-col items-center justify-center min-h-[300px] gap-4">
              <AlertCircle className="h-16 w-16 text-destructive" />
              <p className="text-muted-foreground text-center max-w-md">{loadError}</p>
              <Button onClick={openInNewTab} variant="outline">
                <ExternalLink className="h-4 w-4 mr-2" />
                Open in new tab
              </Button>
            </div>
          ) : previewType === 'image' && previewUrl ? (
            <div className="flex items-center justify-center min-h-[400px] p-4 overflow-auto">
              <img 
                src={previewUrl} 
                alt={currentDoc?.filename}
                style={{ transform: `scale(${zoom})`, transformOrigin: 'center' }}
                className="max-w-full transition-transform object-contain"
              />
            </div>
          ) : previewType === 'pdf' && isPdfReady ? (
            <div className="w-full h-full flex flex-col min-h-[60vh]">
              {/* All PDF pages stacked vertically — scroll to navigate */}
              <div className="flex-1 overflow-auto flex flex-col items-center gap-4 p-4 bg-muted/20">
                {pdfRenderedPages.map((page, idx) => (
                  <img
                    key={idx}
                    src={page.dataUrl}
                    alt={`Page ${idx + 1} of ${currentDoc?.filename}`}
                    className="max-w-full shadow-lg rounded"
                  />
                ))}
                {pdfLoading && pdfRenderedPages.length < pdfNumPages && (
                  <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading page {pdfRenderedPages.length + 1} of {pdfNumPages}…
                  </div>
                )}
              </div>

              {/* PDF controls */}
              <div className="flex items-center justify-center gap-4 p-3 border-t bg-muted/50">
                <span className="text-sm text-muted-foreground">
                  {pdfNumPages} {pdfNumPages === 1 ? 'page' : 'pages'} — scroll to view
                </span>

                <div className="h-4 w-px bg-border" />
                
                {/* Actions */}
                <Button size="sm" variant="ghost" onClick={openInNewTab}>
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Open in new tab
                </Button>
                {currentDoc && (
                  <Button size="sm" variant="ghost" onClick={handlePrint}>
                    <Printer className="h-4 w-4 mr-2" />
                    Print
                  </Button>
                )}
                {currentDoc && (
                  <Button size="sm" variant="ghost" onClick={() => onDownload(currentDoc)}>
                    <Download className="h-4 w-4 mr-2" />
                    Download
                  </Button>
                )}
                {currentDoc && (
                  <Button size="sm" variant="ghost" onClick={handleShare}>
                    {copied ? (
                      <Check className="h-4 w-4 mr-2 text-green-600" />
                    ) : (
                      <Share2 className="h-4 w-4 mr-2" />
                    )}
                    {copied ? 'Copied!' : 'Share'}
                  </Button>
                )}
              </div>
            </div>
          ) : previewType === 'pdf' && loading ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : previewType === 'text' && textContent ? (
            <pre className="p-4 text-sm overflow-auto whitespace-pre-wrap font-mono bg-background border rounded m-4">
              {textContent}
            </pre>
          ) : (
            <div className="flex flex-col items-center justify-center min-h-[300px] gap-4">
              <FileText className="h-16 w-16 text-muted-foreground" />
              <p className="text-muted-foreground">Preview not available for this file type</p>
              {currentDoc && (
                <Button onClick={() => onDownload(currentDoc)}>
                  <Download className="h-4 w-4 mr-2" />
                  Download to view
                </Button>
              )}
            </div>
          )}

          {showNavigation && (
            <>
              <Button
                size="icon"
                variant="secondary"
                className="absolute left-2 top-1/2 -translate-y-1/2"
                onClick={handlePrev}
                disabled={currentIndex === 0}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="secondary"
                className="absolute right-2 top-1/2 -translate-y-1/2"
                onClick={handleNext}
                disabled={currentIndex === documents.length - 1}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-background/80 px-3 py-1 rounded-full text-sm">
                {currentIndex + 1} / {documents.length}
              </div>
            </>
          )}
        </div>
      </DialogContent>
      {currentDoc && (
        <ShareDocumentDialog
          open={shareOpen}
          onOpenChange={setShareOpen}
          documentId={currentDoc.id}
          filename={currentDoc.filename}
        />
      )}
    </Dialog>
  );

};