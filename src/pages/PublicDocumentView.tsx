import React, { useState, useEffect, useRef } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { 
  FileText, 
  Eye, 
  Download, 
  Shield, 
  AlertCircle, 
  Loader2, 
  Clock,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Maximize
} from 'lucide-react';

interface DocumentData {
  id: string;
  title: string;
  type: string;
  permissions: string[];
  pdf_url?: string;
  html_content?: string;
  created_at: string;
  owner_name?: string;
  page_count?: number;
}

/**
 * Public Document View Page
 * 
 * This page is accessible via /v/:token and tracks every view event.
 * Critical requirement: Must call record-view-event on EVERY page load to notify document owner.
 */
const PublicDocumentView = () => {
  const { token } = useParams<{ token: string }>();
  const [searchParams] = useSearchParams();
  const [document, setDocument] = useState<DocumentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewRecorded, setViewRecorded] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(100);
  const [sessionId] = useState(() => crypto.randomUUID());
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // CRITICAL: Record view event on EVERY load
  useEffect(() => {
    if (token && !viewRecorded) {
      recordViewEvent();
    }
  }, [token]);

  // Load document after recording view
  useEffect(() => {
    if (token && viewRecorded) {
      loadDocument();
    }
  }, [token, viewRecorded]);

  /**
   * Record the view event - called on every page load
   * This notifies the document owner that someone viewed their document
   */
  const recordViewEvent = async () => {
    try {
      const viewerEmail = searchParams.get('email') || undefined;
      const viewerName = searchParams.get('name') || undefined;

      const { data, error: recordError } = await supabase.functions.invoke('record-view-event', {
        body: {
          token,
          viewer_email: viewerEmail,
          viewer_name: viewerName,
          session_id: sessionId,
        },
      });

      if (recordError) {
        console.error('Failed to record view event:', recordError);
        // Don't block document loading if view recording fails
      } else {
        console.log('View event recorded:', data);
      }

      setViewRecorded(true);
    } catch (err) {
      console.error('Error recording view:', err);
      setViewRecorded(true); // Still allow document viewing
    }
  };

  /**
   * Load document data via token exchange
   */
  const loadDocument = async () => {
    try {
      setLoading(true);

      const { data, error: validateError } = await supabase.functions.invoke('validate-view-token', {
        body: { token },
      });

      if (validateError || !data?.success) {
        setError(data?.error?.message || 'Invalid or expired link. Please request a new link from the sender.');
        return;
      }

      setDocument(data.data);
    } catch (err) {
      console.error('Error loading document:', err);
      setError('Failed to load document. Please try again later.');
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = async () => {
    if (!document?.pdf_url) {
      toast.error('Download not available for this document');
      return;
    }

    try {
      const link = window.document.createElement('a');
      link.href = document.pdf_url;
      link.download = `${document.title || 'document'}.pdf`;
      window.document.body.appendChild(link);
      link.click();
      window.document.body.removeChild(link);
      toast.success('Download started');
    } catch (err) {
      toast.error('Failed to download document');
    }
  };

  const handleZoomIn = () => setZoom(prev => Math.min(prev + 25, 200));
  const handleZoomOut = () => setZoom(prev => Math.max(prev - 25, 50));
  const handleFullscreen = () => {
    if (iframeRef.current) {
      iframeRef.current.requestFullscreen?.();
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-muted flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
            <p className="text-muted-foreground">Loading document...</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-muted flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center py-12">
            <AlertCircle className="h-12 w-12 text-destructive mb-4" />
            <h2 className="text-lg font-semibold mb-2">Unable to Load Document</h2>
            <p className="text-muted-foreground text-center">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted">
      {/* Header Bar */}
      <header className="bg-background border-b sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            {/* Document Info */}
            <div className="flex items-center gap-3">
              <FileText className="h-5 w-5 text-primary" />
              <div>
                <h1 className="font-semibold text-lg">{document?.title || 'Document'}</h1>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  {document?.owner_name && (
                    <>
                      <span>Shared by {document.owner_name}</span>
                      <span>•</span>
                    </>
                  )}
                  <Badge variant="outline" className="text-xs">
                    <Eye className="h-3 w-3 mr-1" />
                    View Only
                  </Badge>
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2">
              {/* Zoom Controls */}
              <div className="hidden sm:flex items-center gap-1 border rounded-md">
                <Button variant="ghost" size="sm" onClick={handleZoomOut} disabled={zoom <= 50}>
                  <ZoomOut className="h-4 w-4" />
                </Button>
                <span className="text-sm w-12 text-center">{zoom}%</span>
                <Button variant="ghost" size="sm" onClick={handleZoomIn} disabled={zoom >= 200}>
                  <ZoomIn className="h-4 w-4" />
                </Button>
              </div>

              <Button variant="ghost" size="sm" onClick={handleFullscreen}>
                <Maximize className="h-4 w-4" />
              </Button>

              {document?.permissions?.includes('download') && (
                <Button variant="outline" size="sm" onClick={handleDownload}>
                  <Download className="h-4 w-4 mr-2" />
                  Download
                </Button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Document Viewer */}
      <main className="max-w-7xl mx-auto p-4">
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            {document?.pdf_url ? (
              <div className="relative bg-muted">
                <iframe
                  ref={iframeRef}
                  src={`${document.pdf_url}#toolbar=0&navpanes=0`}
                  className="w-full border-0"
                  style={{ 
                    height: 'calc(100vh - 200px)',
                    transform: `scale(${zoom / 100})`,
                    transformOrigin: 'top center',
                  }}
                  title={document.title || 'Document Preview'}
                />
              </div>
            ) : document?.html_content ? (
              <div 
                className="p-8 bg-background prose prose-sm max-w-none"
                style={{ transform: `scale(${zoom / 100})`, transformOrigin: 'top left' }}
                dangerouslySetInnerHTML={{ __html: document.html_content }}
              />
            ) : (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <FileText className="h-16 w-16 mb-4 opacity-50" />
                <p>No preview available for this document</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Page Navigation (for multi-page documents) */}
        {document?.page_count && document.page_count > 1 && (
          <div className="flex items-center justify-center gap-4 mt-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage <= 1}
            >
              <ChevronLeft className="h-4 w-4" />
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {currentPage} of {document.page_count}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(p => Math.min(document.page_count!, p + 1))}
              disabled={currentPage >= (document.page_count || 1)}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}

        {/* Security Footer */}
        <div className="mt-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <Shield className="h-3 w-3" />
          <span>This document is shared securely. Views are tracked and logged.</span>
        </div>
      </main>
    </div>
  );
};

export default PublicDocumentView;
