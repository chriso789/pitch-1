import { useParams, useNavigate } from "react-router-dom";
import { GlobalLayout } from "@/shared/components/layout/GlobalLayout";
import { usePdfWorkspaceDocument } from "@/hooks/usePdfWorkspaceDocument";
import { usePdfWorkspaceVersions } from "@/hooks/usePdfWorkspaceVersions";
import { usePdfSmartTags } from "@/hooks/usePdfSmartTags";
import { usePdfAiRewrite } from "@/hooks/usePdfAiRewrite";
import { hasApryseKey } from "@/lib/pdf-editor/pdfEditorAdapter";
import { savePdfWorkspaceVersion } from "@/lib/pdf-workspace/savePdfWorkspaceVersion";
import { useEffectiveTenantId } from "@/hooks/useEffectiveTenantId";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ArrowLeft, Save, Download, History, Tags, Wand2, ShieldCheck, FileText, AlertTriangle, Copy, Check } from "lucide-react";

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
  const [showFinalize, setShowFinalize] = useState(false);
  const [aiInstruction, setAiInstruction] = useState("");
  const [aiSelectedText, setAiSelectedText] = useState("");
  const [aiResult, setAiResult] = useState<string | null>(null);
  const [copiedTag, setCopiedTag] = useState<string | null>(null);

  const hasEditor = hasApryseKey();

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
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <Button variant="ghost" size="icon" onClick={() => navigate("/documents/pdf-workspace")}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="text-lg font-semibold truncate flex-1">{wsDoc.title}</h1>
        <Badge variant="outline">{wsDoc.status}</Badge>
        <Button variant="outline" size="sm" disabled={!pdfUrl} onClick={() => pdfUrl && window.open(pdfUrl, '_blank')}>
          <Download className="h-4 w-4 mr-1" />Download
        </Button>
        <Button size="sm" onClick={() => setShowFinalize(true)} disabled={wsDoc.status === 'finalized'}>
          <ShieldCheck className="h-4 w-4 mr-1" />Finalize
        </Button>
      </div>

      <div className="flex gap-4 h-[calc(100vh-200px)]">
        {/* Left: PDF viewer */}
        <div className="flex-[7] border rounded-lg overflow-hidden bg-muted/30">
          {!hasEditor && (
            <Alert className="m-4">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Advanced PDF editing requires an Apryse license key. Basic upload, versioning, and smart tags are active.
                Set <code>VITE_APRYSE_LICENSE_KEY</code> to enable full editing.
              </AlertDescription>
            </Alert>
          )}
          {isPdfLoading ? (
            <div className="flex items-center justify-center h-full">
              <div className="h-6 w-6 animate-spin rounded-full border-4 border-primary border-t-transparent" />
            </div>
          ) : pdfUrl ? (
            <iframe src={pdfUrl} className="w-full h-full" title="PDF Viewer" />
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
              <TabsTrigger value="versions"><History className="h-3.5 w-3.5 mr-1" />Versions</TabsTrigger>
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
                      <div className="flex gap-2 mt-2">
                        <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(aiResult); toast({ title: "Copied!" }); }}>
                          <Copy className="h-3 w-3 mr-1" />Copy
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div>
            </TabsContent>

            {/* Versions */}
            <TabsContent value="versions" className="flex-1 overflow-hidden">
              <ScrollArea className="h-full">
                <div className="space-y-2 p-2">
                  {versions.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">No versions yet.</p>
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
            Finalizing will create a locked version. Draft versions remain available for reference.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowFinalize(false)}>Cancel</Button>
            <Button onClick={() => { setShowFinalize(false); toast({ title: "Finalize", description: "Enable Apryse editor to flatten and finalize PDFs." }); }}>
              <ShieldCheck className="h-4 w-4 mr-1" />Finalize
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </GlobalLayout>
  );
};

export default PdfWorkspaceEditor;
