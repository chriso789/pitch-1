import { useParams, useNavigate } from "react-router-dom";
import { GlobalLayout } from "@/shared/components/layout/GlobalLayout";
import { usePdfWorkspaceDocument } from "@/hooks/usePdfWorkspaceDocument";
import { usePdfWorkspaceVersions } from "@/hooks/usePdfWorkspaceVersions";
import { usePdfSmartTags } from "@/hooks/usePdfSmartTags";
import { usePdfAiRewrite } from "@/hooks/usePdfAiRewrite";
import { usePdfEngine } from "@/hooks/usePdfEngine";
import { savePdfWorkspaceVersion } from "@/lib/pdf-workspace/savePdfWorkspaceVersion";
import { useEffectiveTenantId } from "@/hooks/useEffectiveTenantId";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useState, useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { EditorToolbar, type EditorMode } from "@/components/pdf-engine/EditorToolbar";
import { PdfOverlayEditor } from "@/components/pdf-engine/PdfOverlayEditor";
import { PageThumbnailStrip } from "@/components/pdf-engine/PageThumbnailStrip";
import { renderPageToDataUrl } from "@/lib/pdfRenderer";
import { loadPDFFromArrayBuffer } from "@/lib/pdfRenderer";
import {
  ArrowLeft, Save, Download, History, Tags, Wand2, ShieldCheck,
  FileText, AlertTriangle, Copy, Check, Layers, ZoomIn, ZoomOut
} from "lucide-react";

const PdfWorkspaceEditor = () => {
  const { documentId } = useParams<{ documentId: string }>();
  const navigate = useNavigate();
  const tenantId = useEffectiveTenantId();
  const { user } = useAuth();
  const { toast } = useToast();
  const { document: wsDoc, isLoading, pdfUrl, isPdfLoading } = usePdfWorkspaceDocument(documentId);
  const { versions } = usePdfWorkspaceVersions(documentId);
  const smartTagsQuery = usePdfSmartTags(wsDoc?.pipeline_entry_id, wsDoc?.estimate_id);
  const aiRewrite = usePdfAiRewrite();
  const engine = usePdfEngine(documentId);

  const [showFinalize, setShowFinalize] = useState(false);
  const [aiInstruction, setAiInstruction] = useState("");
  const [aiSelectedText, setAiSelectedText] = useState("");
  const [aiResult, setAiResult] = useState<string | null>(null);
  const [copiedTag, setCopiedTag] = useState<string | null>(null);
  const [editorMode, setEditorMode] = useState<EditorMode>('select');
  const [activePage, setActivePage] = useState(1);
  const [pageImages, setPageImages] = useState<Map<number, string>>(new Map());
  const [thumbnailUrls, setThumbnailUrls] = useState<Map<number, string>>(new Map());
  const [isSaving, setIsSaving] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const originalBytesRef = useRef<ArrayBuffer | null>(null);

  // Load and render PDF pages when URL is available
  useEffect(() => {
    if (!pdfUrl) return;

    (async () => {
      try {
        const response = await fetch(pdfUrl);
        const arrayBuffer = await response.arrayBuffer();
        originalBytesRef.current = arrayBuffer;

        const pdf = await loadPDFFromArrayBuffer(arrayBuffer);
        const images = new Map<number, string>();
        const thumbs = new Map<number, string>();

        const pageCount = pdf.numPages;
        for (let i = 1; i <= Math.min(pageCount, 50); i++) {
          const rendered = await renderPageToDataUrl(pdf, i, 1.5, documentId, false);
          images.set(i, rendered.dataUrl);
          // Smaller thumbnail
          const thumb = await renderPageToDataUrl(pdf, i, 0.3, `${documentId}-thumb`, true, 0.6);
          thumbs.set(i, thumb.dataUrl);
        }

        setPageImages(images);
        setThumbnailUrls(thumbs);

        // Auto-extract objects if no pages exist yet
        if (engine.pages.length === 0 && documentId) {
          setIsExtracting(true);
          await engine.extractAndPersist(arrayBuffer);
          setIsExtracting(false);
        }

        pdf.destroy();
      } catch (err) {
        console.error('[PdfEditor] Failed to load PDF:', err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfUrl, documentId]);

  const handleCopyTag = (value: string, key: string) => {
    navigator.clipboard.writeText(value);
    setCopiedTag(key);
    setTimeout(() => setCopiedTag(null), 1500);
    toast({ title: "Copied", description: `${key} value copied to clipboard` });
  };

  const handleAiRewrite = async () => {
    if (!documentId || !aiSelectedText || !aiInstruction) return;
    try {
      const result = await aiRewrite.mutateAsync({
        workspaceDocumentId: documentId,
        selectedText: aiSelectedText,
        instruction: aiInstruction,
      });
      setAiResult(result?.replacement_text || "No suggestion returned.");
    } catch (err: any) {
      toast({ title: "AI Rewrite failed", description: err.message, variant: "destructive" });
    }
  };

  const handleTextEdit = useCallback(async (objectId: string, newText: string) => {
    const obj = engine.objects.find(o => o.id === objectId);
    if (!obj) return;
    await engine.pushOperation('replace_text', {
      original_text: obj.content,
      new_text: newText,
    }, objectId);
  }, [engine]);

  const handleObjectMoved = useCallback(async (objectId: string, x: number, y: number) => {
    const obj = engine.objects.find(o => o.id === objectId);
    if (!obj) return;
    await engine.pushOperation('move_object', {
      from_x: obj.x,
      from_y: obj.y,
      to_x: x,
      to_y: y,
    }, objectId);
  }, [engine]);

  const handleAddRedaction = useCallback(async (redaction: any) => {
    await engine.pushOperation('add_redaction', {
      x: redaction.x,
      y: redaction.y,
      width: redaction.width,
      height: redaction.height,
      page_number: redaction.pageNumber,
    });
  }, [engine]);

  const handleAddAnnotation = useCallback(async (annotation: any) => {
    await engine.pushOperation('add_annotation', {
      x: annotation.x,
      y: annotation.y,
      width: annotation.width,
      height: annotation.height,
      text: annotation.text,
      page_number: annotation.pageNumber,
    });
  }, [engine]);

  const handleCompile = useCallback(async () => {
    if (!originalBytesRef.current) {
      toast({ title: "No PDF loaded", variant: "destructive" });
      return;
    }
    try {
      const blob = await engine.compile(originalBytesRef.current);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${wsDoc?.title || 'compiled'}_pitch.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "PDF compiled", description: `${engine.operations.filter(o => !o.is_undone).length} operations applied` });
    } catch (err: any) {
      toast({ title: "Compile failed", description: err.message, variant: "destructive" });
    }
  }, [engine, wsDoc, toast]);

  const handleSave = useCallback(async () => {
    if (!documentId || !tenantId || !user?.id || !originalBytesRef.current) return;
    setIsSaving(true);
    try {
      const blob = await engine.compile(originalBytesRef.current);
      await savePdfWorkspaceVersion({
        workspaceDocumentId: documentId,
        tenantId,
        userId: user.id,
        fileBlob: blob,
        changeSummary: `${engine.operations.filter(o => !o.is_undone).length} operations applied`,
      });
      toast({ title: "Saved", description: "New version created" });
    } catch (err: any) {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  }, [documentId, tenantId, user, engine, toast]);

  const handleFinalize = useCallback(async () => {
    if (!documentId || !tenantId || !user?.id || !originalBytesRef.current) return;
    setShowFinalize(false);
    setIsSaving(true);
    try {
      const blob = await engine.compile(originalBytesRef.current);
      await savePdfWorkspaceVersion({
        workspaceDocumentId: documentId,
        tenantId,
        userId: user.id,
        fileBlob: blob,
        flattened: true,
        changeSummary: 'Finalized — all operations compiled and flattened',
      });
      toast({ title: "Finalized", description: "Locked PDF version created" });
    } catch (err: any) {
      toast({ title: "Finalize failed", description: err.message, variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  }, [documentId, tenantId, user, engine, toast]);

  // Active page data
  const activePageImage = pageImages.get(activePage);
  const activePageMeta = engine.pages.find(p => p.page_number === activePage);
  const activePageObjects = engine.objects.filter(
    o => (o.metadata as any)?.page_number === activePage
  );

  if (isLoading) {
    return (
      <GlobalLayout>
        <div className="flex justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        </div>
      </GlobalLayout>
    );
  }

  if (!wsDoc) {
    return (
      <GlobalLayout>
        <div className="text-center py-20">
          <h2 className="text-xl font-semibold">Document not found</h2>
          <Button variant="link" onClick={() => navigate("/documents/pdf-workspace")}>Back to PDF Workspace</Button>
        </div>
      </GlobalLayout>
    );
  }

  return (
    <GlobalLayout>
      {/* Header */}
      <div className="flex items-center gap-3 mb-2 flex-wrap">
        <Button variant="ghost" size="icon" onClick={() => navigate("/documents/pdf-workspace")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-lg font-semibold truncate flex-1">{wsDoc.title}</h1>
        <Badge variant="outline">{wsDoc.status}</Badge>
        {isExtracting && (
          <Badge variant="secondary" className="animate-pulse">
            <Layers className="h-3 w-3 mr-1" />Extracting objects...
          </Badge>
        )}
        <Button size="sm" onClick={() => setShowFinalize(true)} disabled={wsDoc.status === 'finalized'}>
          <ShieldCheck className="h-4 w-4 mr-1" />Finalize
        </Button>
      </div>

      {/* Toolbar */}
      <EditorToolbar
        mode={editorMode}
        onModeChange={setEditorMode}
        canUndo={engine.canUndo}
        canRedo={engine.canRedo}
        onUndo={engine.undo}
        onRedo={engine.redo}
        onCompile={handleCompile}
        onSave={handleSave}
        isCompiling={engine.isCompiling}
        isSaving={isSaving}
        operationCount={engine.operations.filter(o => !o.is_undone).length}
      />

      <div className="flex gap-2 h-[calc(100vh-240px)] mt-2">
        {/* Left: Page thumbnails */}
        <div className="w-28 flex-shrink-0 border rounded-lg overflow-hidden bg-muted/30 hidden lg:block">
          <ScrollArea className="h-full">
            <PageThumbnailStrip
              pages={engine.pages}
              activePage={activePage}
              onSelectPage={setActivePage}
              thumbnailUrls={thumbnailUrls}
            />
          </ScrollArea>
        </div>

        {/* Center: PDF overlay editor */}
        <div className="flex-[7] border rounded-lg overflow-auto bg-muted/10">
          {isPdfLoading ? (
            <div className="flex items-center justify-center h-full">
              <div className="h-6 w-6 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            </div>
          ) : activePageImage && activePageMeta ? (
            <div className="flex items-start justify-center p-4">
              <PdfOverlayEditor
                pageImageUrl={activePageImage}
                pageWidth={activePageMeta.width}
                pageHeight={activePageMeta.height}
                pageNumber={activePage}
                objects={activePageObjects}
                onTextEdit={handleTextEdit}
                onObjectMoved={handleObjectMoved}
                onAddAnnotation={handleAddAnnotation}
                onAddRedaction={handleAddRedaction}
                mode={editorMode === 'text' ? 'select' : editorMode}
                scale={1.5}
              />
            </div>
          ) : activePageImage ? (
            // Fallback: just show the rendered page image if no object extraction yet
            <div className="flex items-start justify-center p-4">
              <img src={activePageImage} alt={`Page ${activePage}`} className="max-w-full shadow-lg rounded" />
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground">
              <FileText className="h-8 w-8 mr-2" />Unable to load PDF
            </div>
          )}
        </div>

        {/* Right: Intelligence panel */}
        <div className="flex-[3] min-w-[280px] hidden md:block">
          <Tabs defaultValue="tags" className="h-full flex flex-col">
            <TabsList className="grid grid-cols-3 w-full">
              <TabsTrigger value="tags"><Tags className="h-3.5 w-3.5 mr-1" />Tags</TabsTrigger>
              <TabsTrigger value="ai"><Wand2 className="h-3.5 w-3.5 mr-1" />AI</TabsTrigger>
              <TabsTrigger value="versions"><History className="h-3.5 w-3.5 mr-1" />History</TabsTrigger>
            </TabsList>

            {/* Smart Tags */}
            <TabsContent value="tags" className="flex-1 overflow-hidden">
              <ScrollArea className="h-full">
                <div className="space-y-1 p-2">
                  {smartTagsQuery.data && smartTagsQuery.data.length > 0 ? (
                    Object.entries(
                      smartTagsQuery.data.reduce((acc: Record<string, any[]>, tag: any) => {
                        (acc[tag.category] ||= []).push(tag);
                        return acc;
                      }, {})
                    ).map(([category, tags]: [string, any[]]) => (
                      <div key={category} className="mb-3">
                        <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-1">{category}</h4>
                        {tags.map((tag: any) => (
                          <button
                            key={tag.key}
                            className="flex items-center justify-between w-full px-2 py-1.5 text-sm rounded hover:bg-accent/50 transition-colors"
                            onClick={() => handleCopyTag(tag.value, tag.key)}
                          >
                            <span className="truncate">{tag.label}</span>
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              {copiedTag === tag.key ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                              {tag.value ? tag.value.slice(0, 20) : "—"}
                            </span>
                          </button>
                        ))}
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      Link this document to a job or estimate to see smart tags.
                    </p>
                  )}
                </div>
              </ScrollArea>
            </TabsContent>

            {/* AI Rewrite */}
            <TabsContent value="ai" className="flex-1">
              <div className="space-y-3 p-2">
                <Textarea placeholder="Paste selected PDF text here..." value={aiSelectedText} onChange={e => setAiSelectedText(e.target.value)} rows={4} />
                <Input placeholder="Instruction (e.g. 'Make more professional')" value={aiInstruction} onChange={e => setAiInstruction(e.target.value)} />
                <Button className="w-full" disabled={!aiSelectedText || !aiInstruction || aiRewrite.isPending} onClick={handleAiRewrite}>
                  <Wand2 className="h-4 w-4 mr-1" />{aiRewrite.isPending ? "Rewriting..." : "Get AI Suggestion"}
                </Button>
                {aiResult && (
                  <Card>
                    <CardHeader className="py-2 px-3"><CardTitle className="text-sm">Suggestion</CardTitle></CardHeader>
                    <CardContent className="px-3 pb-3">
                      <p className="text-sm whitespace-pre-wrap">{aiResult}</p>
                      <Button size="sm" variant="outline" className="mt-2" onClick={() => { navigator.clipboard.writeText(aiResult); toast({ title: "Copied!" }); }}>
                        <Copy className="h-3 w-3 mr-1" />Copy
                      </Button>
                    </CardContent>
                  </Card>
                )}
              </div>
            </TabsContent>

            {/* Versions / Operation History */}
            <TabsContent value="versions" className="flex-1 overflow-hidden">
              <ScrollArea className="h-full">
                <div className="space-y-2 p-2">
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase">Operations</h4>
                  {engine.operations.length > 0 ? (
                    [...engine.operations].reverse().slice(0, 30).map((op) => (
                      <div key={op.id} className={`text-xs p-2 rounded border ${op.is_undone ? 'opacity-40 line-through' : ''}`}>
                        <span className="font-medium">{op.operation_type.replace(/_/g, ' ')}</span>
                        <span className="text-muted-foreground ml-2">#{op.sequence_number}</span>
                      </div>
                    ))
                  ) : (
                    <p className="text-sm text-muted-foreground text-center py-2">No edits yet</p>
                  )}

                  <h4 className="text-xs font-semibold text-muted-foreground uppercase mt-4">Saved Versions</h4>
                  {versions.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-2">No versions yet.</p>
                  ) : versions.map((v: any) => (
                    <Card key={v.id} className="p-3">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-sm">v{v.version_number}</span>
                        {v.flattened && <Badge variant="outline" className="text-xs">Finalized</Badge>}
                      </div>
                      <p className="text-xs text-muted-foreground">{v.change_summary}</p>
                      <p className="text-xs text-muted-foreground">{new Date(v.created_at).toLocaleString()}</p>
                    </Card>
                  ))}
                </div>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      {/* Finalize Dialog */}
      <Dialog open={showFinalize} onOpenChange={setShowFinalize}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Finalize PDF</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Finalizing will compile all {engine.operations.filter(o => !o.is_undone).length} operations into a locked PDF version. Draft versions remain available.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowFinalize(false)}>Cancel</Button>
            <Button onClick={handleFinalize} disabled={isSaving}>
              <ShieldCheck className="h-4 w-4 mr-1" />{isSaving ? 'Compiling...' : 'Finalize'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </GlobalLayout>
  );
};

export default PdfWorkspaceEditor;
