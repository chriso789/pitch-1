import React, { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Download, ZoomIn, ZoomOut, ChevronLeft, ChevronRight, FileText, Loader2, AlertCircle, ExternalLink } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { resolveStorageBucket } from '@/lib/documents/resolveStorageBucket';
import { loadPDFFromArrayBuffer, renderPageToDataUrl, PDFDocumentProxy, RenderedPage, clearPageCache } from '@/lib/pdfRenderer';

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

  // PDF.js state
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [pdfNumPages, setPdfNumPages] = useState(0);
  const [pdfCurrentPage, setPdfCurrentPage] = useState(1);
  const [pdfRenderedPage, setPdfRenderedPage] = useState<RenderedPage | null>(null);
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
    setPdfCurrentPage(1);
    setPdfRenderedPage(null);
    clearPageCache();
  }, []);

  // Render current PDF page when page or scale changes
  useEffect(() => {
    if (!pdfDoc || pdfCurrentPage < 1 || pdfCurrentPage > pdfNumPages) return;

    const renderPage = async () => {
      setPdfLoading(true);
      try {
        const rendered = await renderPageToDataUrl(pdfDoc, pdfCurrentPage, pdfScale);
        setPdfRenderedPage(rendered);
      } catch (error) {
        console.error('[PDF] Error rendering page:', error);
      } finally {
        setPdfLoading(false);
      }
    };

    renderPage();
  }, [pdfDoc, pdfCurrentPage, pdfScale, pdfNumPages]);

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

      // Determine the correct storage bucket
      const bucket = resolveStorageBucket(currentDoc.document_type, currentDoc.file_path);
      console.log(`[Preview] Loading from bucket: ${bucket}, path: ${currentDoc.file_path}`);

      // Public buckets - use getPublicUrl (no RLS checks needed)
      const PUBLIC_BUCKETS = ['smartdoc-assets', 'company-logos', 'avatars', 
                              'roof-reports', 'customer-photos', 'documents',
                              'measurement-visualizations', 'measurement-reports'];
      const isPublicBucket = PUBLIC_BUCKETS.includes(bucket);

      try {
        const mimeType = currentDoc.mime_type || '';
        const filename = currentDoc.filename.toLowerCase();
        const isPDF = mimeType === 'application/pdf' || filename.endsWith('.pdf');
        
        // For PDFs, download and render with PDF.js to avoid iframe blocking
        if (isPDF) {
          console.log('[PDF] Downloading PDF for in-app rendering...');
          const { data, error } = await supabase.storage
            .from(bucket)
            .download(currentDoc.file_path);
          
          if (error) throw error;
          
          const arrayBuffer = await data.arrayBuffer();
          console.log('[PDF] Loading PDF with PDF.js...');
          const pdf = await loadPDFFromArrayBuffer(arrayBuffer);
          
          setPdfDoc(pdf);
          setPdfNumPages(pdf.numPages);
          setPdfCurrentPage(1);
          setPdfScale(1.5);
          
          // Render first page
          const rendered = await renderPageToDataUrl(pdf, 1, 1.5);
          setPdfRenderedPage(rendered);
          setPreviewUrl(null); // Clear preview URL since we're using PDF.js
          
          // Also store public/signed URL for "Open in new tab"
          if (isPublicBucket) {
            const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(currentDoc.file_path);
            setPreviewUrl(urlData.publicUrl);
          } else {
            const { data: signedData } = await supabase.storage
              .from(bucket)
              .createSignedUrl(currentDoc.file_path, 3600);
            if (signedData?.signedUrl) {
              setPreviewUrl(signedData.signedUrl);
            }
          }
        } else if (mimeType.startsWith('text/') || 
            mimeType === 'application/json' ||
            currentDoc.filename.match(/\.(txt|csv|json|md|log)$/i)) {
          // Text files - download and display content
          const { data, error } = await supabase.storage
            .from(bucket)
            .download(currentDoc.file_path);
          if (error) throw error;
          const text = await data.text();
          setTextContent(text);
          setPreviewUrl(null);
        } else {
          // Images and other files - use public URL or blob URL
          if (isPublicBucket) {
            const { data } = supabase.storage.from(bucket).getPublicUrl(currentDoc.file_path);
            setPreviewUrl(data.publicUrl);
          } else {
            const { data, error } = await supabase.storage
              .from(bucket)
              .download(currentDoc.file_path);
            if (error) throw error;
            const url = URL.createObjectURL(data);
            setPreviewUrl(url);
          }
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
  }, [currentDoc?.id, isOpen, cleanupPdf]);

  // Open document in new tab using public or signed URL
  const openInNewTab = async () => {
    if (!currentDoc) return;
    
    // If we have a stored preview URL for PDFs, use it
    if (previewUrl && previewUrl.startsWith('http')) {
      window.open(previewUrl, '_blank');
      return;
    }
    
    const bucket = resolveStorageBucket(currentDoc.document_type, currentDoc.file_path);
    const PUBLIC_BUCKETS = ['smartdoc-assets', 'company-logos', 'avatars', 
                            'roof-reports', 'customer-photos', 'documents',
                            'measurement-visualizations', 'measurement-reports'];
    const isPublicBucket = PUBLIC_BUCKETS.includes(bucket);
    
    if (isPublicBucket) {
      const { data } = supabase.storage.from(bucket).getPublicUrl(currentDoc.file_path);
      window.open(data.publicUrl, '_blank');
    } else {
      const { data } = await supabase.storage.from(bucket).createSignedUrl(currentDoc.file_path, 3600);
      if (data?.signedUrl) {
        window.open(data.signedUrl, '_blank');
      }
    }
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

  // PDF page navigation
  const handlePdfPrevPage = () => {
    if (pdfCurrentPage > 1) setPdfCurrentPage(p => p - 1);
  };

  const handlePdfNextPage = () => {
    if (pdfCurrentPage < pdfNumPages) setPdfCurrentPage(p => p + 1);
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
  const isPdfReady = pdfDoc && pdfRenderedPage;

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
                <Button size="sm" variant="outline" onClick={() => onDownload(currentDoc)}>
                  <Download className="h-4 w-4 mr-2" />
                  Download
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
              {/* PDF rendered page */}
              <div className="flex-1 overflow-auto flex items-start justify-center p-4 bg-muted/20">
                {pdfLoading ? (
                  <div className="flex items-center justify-center min-h-[400px]">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <img 
                    src={pdfRenderedPage.dataUrl} 
                    alt={`Page ${pdfCurrentPage} of ${currentDoc?.filename}`}
                    className="max-w-full shadow-lg rounded"
                    style={{ maxHeight: '70vh' }}
                  />
                )}
              </div>
              
              {/* PDF controls */}
              <div className="flex items-center justify-center gap-4 p-3 border-t bg-muted/50">
                {/* Page navigation */}
                <div className="flex items-center gap-2">
                  <Button 
                    size="sm" 
                    variant="ghost" 
                    onClick={handlePdfPrevPage}
                    disabled={pdfCurrentPage <= 1 || pdfLoading}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <span className="text-sm text-muted-foreground min-w-[80px] text-center">
                    Page {pdfCurrentPage} / {pdfNumPages}
                  </span>
                  <Button 
                    size="sm" 
                    variant="ghost" 
                    onClick={handlePdfNextPage}
                    disabled={pdfCurrentPage >= pdfNumPages || pdfLoading}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
                
                <div className="h-4 w-px bg-border" />
                
                {/* Actions */}
                <Button size="sm" variant="ghost" onClick={openInNewTab}>
                  <ExternalLink className="h-4 w-4 mr-2" />
                  Open in new tab
                </Button>
                {currentDoc && (
                  <Button size="sm" variant="ghost" onClick={() => onDownload(currentDoc)}>
                    <Download className="h-4 w-4 mr-2" />
                    Download
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
    </Dialog>
  );
};