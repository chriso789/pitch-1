import React, { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Download, X, ZoomIn, ZoomOut, ChevronLeft, ChevronRight, FileText, Loader2, AlertCircle, ExternalLink } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { resolveStorageBucket } from '@/lib/documents/resolveStorageBucket';

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

  const currentDoc = documents.length > 0 ? documents[currentIndex] : document;

  useEffect(() => {
    if (document && documents.length > 0) {
      const idx = documents.findIndex(d => d.id === document.id);
      if (idx >= 0) setCurrentIndex(idx);
    }
  }, [document, documents]);

  useEffect(() => {
    if (!currentDoc || !isOpen) {
      setPreviewUrl(null);
      setTextContent(null);
      setLoadError(null);
      return;
    }

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

      try {
        const { data, error } = await supabase.storage
          .from(bucket)
          .download(currentDoc.file_path);

        if (error) throw error;

        const mimeType = currentDoc.mime_type || '';
        
        if (mimeType.startsWith('text/') || 
            mimeType === 'application/json' ||
            currentDoc.filename.match(/\.(txt|csv|json|md|log)$/i)) {
          const text = await data.text();
          setTextContent(text);
          setPreviewUrl(null);
        } else {
          const url = URL.createObjectURL(data);
          setPreviewUrl(url);
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
  }, [currentDoc, isOpen]);

  // Open document in new tab using signed URL
  const openInNewTab = async () => {
    if (!currentDoc) return;
    const bucket = resolveStorageBucket(currentDoc.document_type, currentDoc.file_path);
    const { data } = await supabase.storage.from(bucket).createSignedUrl(currentDoc.file_path, 3600);
    if (data?.signedUrl) {
      window.open(data.signedUrl, '_blank');
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

  const previewType = getPreviewType();
  const showNavigation = documents.length > 1;

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
          ) : previewType === 'pdf' && previewUrl ? (
            <object
              data={previewUrl}
              type="application/pdf"
              className="w-full h-[600px]"
            >
              <embed src={previewUrl} type="application/pdf" className="w-full h-[600px]" />
              <div className="flex flex-col items-center justify-center min-h-[300px] gap-4">
                <FileText className="h-16 w-16 text-muted-foreground" />
                <p className="text-muted-foreground">Unable to display PDF inline</p>
                <Button onClick={() => window.open(previewUrl, '_blank')}>
                  <Download className="h-4 w-4 mr-2" />
                  Open PDF in new tab
                </Button>
              </div>
            </object>
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
