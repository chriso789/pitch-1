import { useParams, useNavigate } from 'react-router-dom';
import { GlobalLayout } from '@/shared/components/layout/GlobalLayout';
import { usePdfEngineV2 } from '@/hooks/usePdfEngineV2';
import { useEffectiveTenantId } from '@/hooks/useEffectiveTenantId';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { PdfEngine } from '@/lib/pdf-engine/PdfEngine';
import { parsePdfToObjectGraph } from '@/lib/pdf-engine/PdfObjectParser';
import { persistParsedPages } from '@/lib/pdf-engine/PdfObjectStore';
import { loadPDFFromArrayBuffer, renderPageToDataUrl } from '@/lib/pdfRenderer';
import { ocrPageImage, persistOcrObjects } from '@/lib/pdf-engine/PdfOcrEngine';
import { aiRewriteText } from '@/lib/pdf-engine/PdfAiRewriter';
import { PdfTemplateEngine, STANDARD_SMART_TAGS } from '@/lib/pdf-engine/PdfTemplateEngine';
import { PdfCanvas } from '@/components/pdf-engine/PdfCanvas';
import { PdfToolbar, type ToolMode } from '@/components/pdf-engine/PdfToolbar';
import { PdfPageSidebar } from '@/components/pdf-engine/PdfPageSidebar';
import { PdfOperationHistory } from '@/components/pdf-engine/PdfOperationHistory';
import { PdfPropertiesPanel } from '@/components/pdf-engine/PdfPropertiesPanel';
import { PdfSearchPanel } from '@/components/pdf-engine/PdfSearchPanel';
import { PdfObjectPropertiesPanel } from '@/components/pdf-engine/PdfObjectPropertiesPanel';
import { PdfAuditPanel } from '@/components/pdf-engine/PdfAuditPanel';
import { PdfAuditEngine } from '@/lib/pdf-engine/PdfAuditEngine';
import { PdfExportReadiness } from '@/lib/pdf-engine/PdfExportReadiness';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  ArrowLeft, Upload, FileText, Layers, History, Settings2, Search, Shield, AlertTriangle
} from 'lucide-react';
import type { PdfEngineObject } from '@/lib/pdf-engine/engineTypes';
import type { RewriteMode } from '@/lib/pdf-engine/PdfAiRewriter';

const PdfEngineEditor = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const tenantId = useEffectiveTenantId();
  const { user } = useAuth();
  const { toast } = useToast();
  const engine = usePdfEngineV2(id);

  const [mode, setMode] = useState<ToolMode>('select');
  const [activePage, setActivePage] = useState(1);
  const [pageImages, setPageImages] = useState<Map<number, string>>(new Map());
  const [thumbnailUrls, setThumbnailUrls] = useState<Map<number, string>>(new Map());
  const [selectedObject, setSelectedObject] = useState<PdfEngineObject | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isOcrRunning, setIsOcrRunning] = useState(false);
  const [showUpload, setShowUpload] = useState(!id);
  const [uploadTitle, setUploadTitle] = useState('');
  const [showTemplateDialog, setShowTemplateDialog] = useState(false);
  const [templateTitle, setTemplateTitle] = useState('');
  const [templateDesc, setTemplateDesc] = useState('');
  const [showExportReadiness, setShowExportReadiness] = useState(false);
  const [exportReadiness, setExportReadiness] = useState<ReturnType<typeof PdfExportReadiness.check> | null>(null);
  const originalBytesRef = useRef<ArrayBuffer | null>(null);

  // Load document info
  const docQuery = useQuery({
    queryKey: ['pdf-document', id],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('pdf_documents')
        .select('*')
        .eq('id', id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  // Load and render PDF when document is available
  useEffect(() => {
    if (!docQuery.data?.original_file_path) return;

    (async () => {
      try {
        const { data: fileData } = await supabase.storage
          .from('pdf-originals')
          .download(docQuery.data.original_file_path);
        if (!fileData) return;

        const arrayBuffer = await fileData.arrayBuffer();
        originalBytesRef.current = arrayBuffer;

        const pdf = await loadPDFFromArrayBuffer(arrayBuffer);
        const images = new Map<number, string>();
        const thumbs = new Map<number, string>();

        for (let i = 1; i <= Math.min(pdf.numPages, 50); i++) {
          const rendered = await renderPageToDataUrl(pdf, i, 1.5, id!, false);
          images.set(i, rendered.dataUrl);
          const thumb = await renderPageToDataUrl(pdf, i, 0.3, `${id}-thumb`, true, 0.6);
          thumbs.set(i, thumb.dataUrl);
        }

        setPageImages(images);
        setThumbnailUrls(thumbs);

        // Auto-parse if no pages exist
        if (engine.pages.length === 0) {
          setIsParsing(true);
          const parsed = await parsePdfToObjectGraph(arrayBuffer);
          await persistParsedPages(id!, parsed);
          engine.invalidate();
          setIsParsing(false);
        }

        pdf.destroy();
      } catch (err) {
        console.error('[PdfEngineEditor] Load error:', err);
      }
    })();
  }, [docQuery.data?.original_file_path, id]);

  const handleUpload = useCallback(async (file: File) => {
    if (!tenantId || !user?.id) return;
    try {
      setIsParsing(true);
      const doc = await PdfEngine.createDocument(file, uploadTitle || file.name, tenantId, user.id);
      setShowUpload(false);
      navigate(`/documents/pdf-engine/${doc.id}`, { replace: true });
    } catch (err: any) {
      toast({ title: 'Upload failed', description: err.message, variant: 'destructive' });
    } finally {
      setIsParsing(false);
    }
  }, [tenantId, user, uploadTitle, navigate, toast]);

  const handleReplaceText = useCallback(async (objectId: string, newText: string) => {
    await engine.pushOperation('replace_text', { replacement_text: newText }, objectId);
    toast({ title: 'Text replaced' });
  }, [engine, toast]);

  const handleDeleteObject = useCallback(async (objectId: string) => {
    await engine.pushOperation('delete_object', {}, objectId);
    setSelectedObject(null);
    toast({ title: 'Object deleted' });
  }, [engine, toast]);

  const handleAddRedaction = useCallback(async (bounds: any) => {
    await engine.pushOperation('add_redaction', {
      x: bounds.x, y: bounds.y,
      width: bounds.width, height: bounds.height,
      page_number: bounds.pageNumber,
    });
  }, [engine]);

  const handleAddAnnotation = useCallback(async (bounds: any) => {
    await engine.pushOperation('add_annotation', {
      x: bounds.x, y: bounds.y,
      width: bounds.width, height: bounds.height,
      text: bounds.text, page_number: bounds.pageNumber,
    });
  }, [engine]);

  // OCR handler
  const handleOcr = useCallback(async () => {
    const pageImage = pageImages.get(activePage);
    const pageMeta = engine.pages.find(p => p.page_number === activePage);
    if (!pageImage || !pageMeta) return;

    setIsOcrRunning(true);
    if (tenantId && user?.id) PdfAuditEngine.log(tenantId, user.id, 'ocr_started', { page: activePage }, id);
    try {
      const result = await ocrPageImage(
        pageImage, activePage, pageMeta.width, pageMeta.height, 1.5
      );
      if (result.words.length > 0) {
        const count = await persistOcrObjects(id!, pageMeta.id, activePage, result);
        await engine.pushOperation('ocr_extract', {
          page_number: activePage,
          objects_created: count,
        });
        engine.invalidate();
        if (tenantId && user?.id) PdfAuditEngine.log(tenantId, user.id, 'ocr_completed', { page: activePage, objects: count }, id);
        toast({ title: 'OCR complete', description: `Extracted ${count} text lines` });
      } else {
        toast({ title: 'No text found', description: 'OCR did not detect text on this page' });
      }
    } catch (err: any) {
      toast({ title: 'OCR failed', description: err.message, variant: 'destructive' });
    } finally {
      setIsOcrRunning(false);
    }
  }, [pageImages, activePage, engine, id, toast]);

  // AI Rewrite handler
  const handleAiRewrite = useCallback(async (
    objectId: string, rewriteMode: RewriteMode, customInstruction?: string
  ) => {
    const obj = engine.objects.find(o => o.id === objectId);
    if (!obj) return;
    const originalText = (obj.content as any)?.text || '';
    if (!originalText) return;

    try {
      const result = await aiRewriteText({
        originalText,
        mode: rewriteMode,
        customInstruction,
      });
      await engine.pushOperation('ai_rewrite', {
        original_text: originalText,
        rewritten_text: result.rewrittenText,
        mode: rewriteMode,
      }, objectId);
      toast({ title: 'Text rewritten', description: `Applied ${rewriteMode} rewrite` });
    } catch (err: any) {
      toast({ title: 'Rewrite failed', description: err.message, variant: 'destructive' });
    }
  }, [engine, toast]);

  // Save as template
  const handleSaveAsTemplate = useCallback(async () => {
    if (!tenantId || !user?.id || !id) return;
    try {
      await PdfTemplateEngine.saveAsTemplate(
        tenantId,
        user.id,
        templateTitle || docQuery.data?.title || 'Untitled Template',
        templateDesc,
        id,
        STANDARD_SMART_TAGS,
        'general',
        docQuery.data?.original_file_path,
        docQuery.data?.page_count
      );
      setShowTemplateDialog(false);
      setTemplateTitle('');
      setTemplateDesc('');
      toast({ title: 'Template saved', description: 'Document saved as reusable template' });
    } catch (err: any) {
      toast({ title: 'Save failed', description: err.message, variant: 'destructive' });
    }
  }, [tenantId, user, id, templateTitle, templateDesc, docQuery.data, toast]);

  const handleCompile = useCallback(async () => {
    if (!originalBytesRef.current) return;
    try {
      const blob = await engine.compile(originalBytesRef.current);
      if (tenantId && user?.id) PdfAuditEngine.log(tenantId, user.id, 'pdf_compiled', { title: docQuery.data?.title }, id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${docQuery.data?.title || 'compiled'}_pitch.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: 'PDF compiled and downloaded' });
    } catch (err: any) {
      toast({ title: 'Compile failed', description: err.message, variant: 'destructive' });
    }
  }, [engine, docQuery.data, toast]);

  const handleSave = useCallback(async () => {
    if (!originalBytesRef.current) return;
    setIsSaving(true);
    try {
      const version = await engine.compileAndVersion(originalBytesRef.current);
      toast({ title: 'Version saved', description: `Version ${version?.version_number} created` });
    } catch (err: any) {
      toast({ title: 'Save failed', description: err.message, variant: 'destructive' });
    } finally {
      setIsSaving(false);
    }
  }, [engine, toast]);

  const handleRotatePage = useCallback(async () => {
    await engine.pushOperation('rotate_page', { page_number: activePage, degrees: 90 });
  }, [engine, activePage]);

  const activePageImage = pageImages.get(activePage);
  const activePageMeta = engine.pages.find(p => p.page_number === activePage);
  const activePageObjects = engine.objects.filter(
    o => (o.metadata as any)?.page_number === activePage
  );
  const activeOpsCount = engine.operations.filter(o => !o.is_undone).length;

  // Upload dialog for new documents
  if (showUpload || !id) {
    return (
      <GlobalLayout>
        <div className="max-w-lg mx-auto py-20">
          <h1 className="text-2xl font-bold mb-4">PDF Engine</h1>
          <p className="text-muted-foreground mb-6">Upload a PDF to begin editing with the PITCH internal engine.</p>
          <Input
            placeholder="Document title"
            value={uploadTitle}
            onChange={e => setUploadTitle(e.target.value)}
            className="mb-3"
          />
          <label className="flex flex-col items-center justify-center w-full h-40 border-2 border-dashed rounded-lg cursor-pointer hover:bg-muted/50 transition-colors">
            <Upload className="h-8 w-8 text-muted-foreground mb-2" />
            <span className="text-sm text-muted-foreground">
              {isParsing ? 'Uploading...' : 'Click to select PDF'}
            </span>
            <input
              type="file"
              accept="application/pdf"
              className="hidden"
              disabled={isParsing}
              onChange={e => {
                const file = e.target.files?.[0];
                if (file) handleUpload(file);
              }}
            />
          </label>
        </div>
      </GlobalLayout>
    );
  }

  return (
    <GlobalLayout>
      {/* Header */}
      <div className="flex items-center gap-3 mb-2 flex-wrap">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-lg font-semibold truncate flex-1">
          {docQuery.data?.title || 'PDF Engine'}
        </h1>
        <Badge variant="outline">{docQuery.data?.status || 'loading'}</Badge>
        {isParsing && (
          <Badge variant="secondary" className="animate-pulse">
            <Layers className="h-3 w-3 mr-1" />Parsing...
          </Badge>
        )}
      </div>

      {/* Toolbar */}
      <PdfToolbar
        mode={mode}
        onModeChange={setMode}
        canUndo={engine.canUndo}
        canRedo={engine.canRedo}
        onUndo={engine.undo}
        onRedo={engine.redo}
        onCompile={handleCompile}
        onSave={handleSave}
        isCompiling={engine.isCompiling}
        isSaving={isSaving}
        operationCount={activeOpsCount}
        onRotatePage={handleRotatePage}
        onOcr={handleOcr}
        isOcrRunning={isOcrRunning}
        onSaveAsTemplate={() => setShowTemplateDialog(true)}
      />

      {/* Main layout */}
      <div className="flex gap-2 h-[calc(100vh-240px)] mt-2">
        {/* Left: Page thumbnails */}
        <div className="w-28 flex-shrink-0 border rounded-lg overflow-hidden bg-muted/30 hidden lg:block">
          <PdfPageSidebar
            pages={engine.pages}
            activePage={activePage}
            onSelectPage={setActivePage}
            thumbnailUrls={thumbnailUrls}
          />
        </div>

        {/* Center: PDF Canvas */}
        <div className="flex-[7] border rounded-lg overflow-auto bg-muted/10">
          {engine.isLoading ? (
            <div className="flex items-center justify-center h-full">
              <div className="h-6 w-6 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            </div>
          ) : activePageImage && activePageMeta ? (
            <div className="flex items-start justify-center p-4">
              <PdfCanvas
                pageImageUrl={activePageImage}
                pageWidth={activePageMeta.width}
                pageHeight={activePageMeta.height}
                pageNumber={activePage}
                objects={activePageObjects}
                mode={mode === 'text' ? 'select' : mode}
                scale={1.5}
                onObjectSelected={setSelectedObject}
                onTextReplace={handleReplaceText}
                onObjectMoved={(objId, x, y) => {
                  engine.pushOperation('move_object', { x, y }, objId);
                }}
                onAddRedaction={handleAddRedaction}
                onAddAnnotation={handleAddAnnotation}
              />
            </div>
          ) : activePageImage ? (
            <div className="flex items-start justify-center p-4">
              <img src={activePageImage} alt={`Page ${activePage}`} className="max-w-full shadow-lg rounded" />
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <FileText className="h-8 w-8 mr-2" />Loading PDF...
            </div>
          )}
        </div>

        {/* Right: Properties + History */}
        <div className="flex-[3] min-w-[260px] hidden md:block">
          <Tabs defaultValue="properties" className="h-full flex flex-col">
            <TabsList className="grid grid-cols-4 w-full">
              <TabsTrigger value="properties"><Settings2 className="h-3.5 w-3.5 mr-1" />Props</TabsTrigger>
              <TabsTrigger value="search"><Search className="h-3.5 w-3.5 mr-1" />Search</TabsTrigger>
              <TabsTrigger value="history"><History className="h-3.5 w-3.5 mr-1" />History</TabsTrigger>
              <TabsTrigger value="audit"><Shield className="h-3.5 w-3.5 mr-1" />Audit</TabsTrigger>
            </TabsList>
            <TabsContent value="properties" className="flex-1 overflow-auto">
              <PdfPropertiesPanel
                selectedObject={selectedObject}
                onReplaceText={handleReplaceText}
                onDeleteObject={handleDeleteObject}
                onAiRewrite={handleAiRewrite}
              />
              {selectedObject && (
                <PdfObjectPropertiesPanel
                  selectedObject={selectedObject}
                  onPushOperation={(type, payload, targetId) => {
                    engine.pushOperation(type, payload, targetId);
                    if (tenantId && user?.id) {
                      PdfAuditEngine.log(tenantId, user.id, type === 'move_object' ? 'object_moved' : type === 'delete_object' ? 'object_deleted' : 'text_replaced', payload, id);
                    }
                  }}
                />
              )}
            </TabsContent>
            <TabsContent value="search" className="flex-1 overflow-auto">
              <PdfSearchPanel
                currentDocumentId={id}
                onJumpToPage={setActivePage}
              />
            </TabsContent>
            <TabsContent value="history" className="flex-1 overflow-hidden">
              <PdfOperationHistory
                operations={engine.operations}
                versions={engine.versions}
              />
            </TabsContent>
            <TabsContent value="audit" className="flex-1 overflow-auto">
              <PdfAuditPanel pdfDocumentId={id} />
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Save as Template Dialog */}
      <Dialog open={showTemplateDialog} onOpenChange={setShowTemplateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save as Template</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              placeholder="Template title"
              value={templateTitle}
              onChange={e => setTemplateTitle(e.target.value)}
            />
            <Textarea
              placeholder="Description (optional)"
              value={templateDesc}
              onChange={e => setTemplateDesc(e.target.value)}
              className="min-h-[80px]"
            />
            <p className="text-xs text-muted-foreground">
              Standard smart tags will be available: {'{'}{'{'} customer_name {'}'}{'}'}, {'{'}{'{'} job_number {'}'}{'}'}, {'{'}{'{'} company_name {'}'}{'}'}...
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowTemplateDialog(false)}>Cancel</Button>
            <Button onClick={handleSaveAsTemplate}>Save Template</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </GlobalLayout>
  );
};

export default PdfEngineEditor;
