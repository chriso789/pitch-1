import { useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { useEffectiveTenantId } from "@/hooks/useEffectiveTenantId";
import { supabase } from "@/integrations/supabase/client";
import { PDFDocument } from "pdf-lib";
import { PageOrganizer, type SaveResult } from "@/components/pdf-pages/PageOrganizer";
import { MarkupEditor } from "@/components/pdf-markup/MarkupEditor";
import { PdfTextInspector } from "@/components/pdf-engine/PdfTextInspector";
import { PdfFormEditor } from "@/components/pdf-engine/PdfFormEditor";
import { Button } from "@/components/ui/button";
import { isPageToolsEnabled } from "@/lib/pdf-pages/featureGate";
import { loadDocumentPdf, saveDocumentVersion, reconcileMeasurements, type DocRow } from "@/lib/pdf-pages/documentVersions";

/**
 * Opens a stored PITCH document (commercial drawing or Smart Docs company file) in the
 * page organizer or markup editor; saves create new linked versions, never overwrite.
 * Routes: /commercial/:id/plans/:documentId/(pages|markup) and /documents/:documentId/(pages|markup)
 */
export default function DocumentPdfToolPage({ tool }: { tool: "pages" | "markup" }) {
  const { id: projectId, documentId } = useParams();
  const [params, setParams] = useSearchParams();
  const inspecting = params.get('mode') === 'text';
  const filling = params.get('mode') === 'forms';
  const tenantId = useEffectiveTenantId();
  const [doc, setDoc] = useState<DocRow | null>(null);
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [failed, setFailed] = useState("");

  useEffect(() => {
    if (!documentId || !tenantId) return;
    loadDocumentPdf(tenantId, documentId).then(({ doc, bytes }) => {
      if (projectId && doc.metadata?.commercial_project_id && doc.metadata.commercial_project_id !== projectId) throw new Error("This drawing belongs to a different project");
      setDoc(doc); setBytes(bytes);
    }).catch((e) => { setFailed(e.message); toast.error(e.message); });
  }, [documentId, tenantId, projectId]);

  const back = projectId ? `/commercial/${projectId}` : "/smartdocs";

  const savePages = async (r: SaveResult) => {
    if (!tenantId || !doc) throw new Error("No company selected");
    const v = await saveDocumentVersion({ tenantId, doc, bytes: r.bytes, kind: "pages", summary: r.summary, metadata: { page_map: r.pageMap } });
    let msg = `Saved "${v.filename}". The original is unchanged.`;
    if (projectId) {
      const rec = await reconcileMeasurements({ tenantId, sourceDocId: doc.id, newDocId: v.id, projectId, map: r.pageMap, cropBoxes: r.cropBoxes });
      const carried = rec.filter((x) => x.status === "carried"), bad = rec.filter((x) => x.status === "invalidated");
      await (supabase as any).from("documents").update({ metadata: { ...(doc.metadata ?? {}), page_map: r.pageMap, versions_root_id: doc.metadata?.versions_root_id ?? doc.id, edited_from_document_id: doc.id, version_number: v.version, version_kind: "pages", measurement_reconciliation: rec } }).eq("id", v.id).eq("tenant_id", tenantId);
      if (carried.length) msg += ` Measurements on ${carried.length} sheet(s) were carried over as drafts and must be re-approved.`;
      if (bad.length) toast.warning(`Measurements on sheet(s) ${bad.map((b) => b.page + 1).join(", ")} were NOT carried over: ${bad[0].reason}`);
    }
    toast.success(msg);
    setDoc({ ...doc, id: v.id, filename: v.filename, metadata: { ...(doc.metadata ?? {}), versions_root_id: doc.metadata?.versions_root_id ?? doc.id } }); setBytes(r.bytes);
  };
  const saveMarkup = async (out: Uint8Array, summary: string) => {
    if (!tenantId || !doc) throw new Error("No company selected");
    const v = await saveDocumentVersion({ tenantId, doc, bytes: out, kind: "markup", summary });
    if (projectId) await reconcileMeasurements({ tenantId, sourceDocId: doc.id, newDocId: v.id, projectId, map: Array.from({ length: (await PDFDocument.load(out, { ignoreEncryption: true })).getPageCount() }, (_, i) => ({ out: i, sourceId: doc.id, sourceIndex: i, rotate: 0, cropped: false, resized: false })), cropBoxes: {} });
    toast.success(`Saved "${v.filename}". The original is unchanged${projectId ? "; measurements were carried over as drafts" : ""}.`);
    setDoc({ ...doc, id: v.id, filename: v.filename, metadata: { ...(doc.metadata ?? {}), versions_root_id: doc.metadata?.versions_root_id ?? doc.id } }); setBytes(out);
  };

  if (!isPageToolsEnabled()) return <div className="p-10 text-center text-muted-foreground">These PDF tools are still being verified and aren't switched on for this site yet.</div>;
  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-3"><Link to={back} className="text-sm inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />{projectId ? "Project" : "Smart Docs"}</Link>
        <h1 className="text-xl font-semibold truncate">{tool === "pages" ? "Organize pages" : inspecting ? "Edit PDF · Text inspection" : "Markup"} · {doc?.filename ?? "Loading…"}</h1></div>
      {tool === 'markup' && <div className="flex flex-wrap gap-2"><Button variant={inspecting ? 'default' : 'outline'} onClick={() => setParams({ mode: 'text' })}>Edit PDF</Button><Button variant={!inspecting && !filling ? 'default' : 'outline'} onClick={() => setParams({})}>Markup &amp; Annotate</Button><Button variant={filling ? 'default' : 'outline'} onClick={() => setParams({ mode: 'forms' })}>Fill Forms</Button><Button variant="outline" asChild><Link to={projectId ? `/commercial/${projectId}/plans/${documentId}/pages` : `/documents/${documentId}/pages`}>Organize Pages</Link></Button></div>}
      {tool === "pages" && projectId && <p className="text-xs text-muted-foreground">Measurements stay valid when sheets are only reordered, duplicated or rotated, and are carried to the new version as drafts for re-approval. Resized sheets, and crops that cut through measured lines, are flagged instead of transferred.</p>}
      {failed ? <p className="text-destructive">{failed}</p> : bytes && doc ? (tool === "pages"
        ? <PageOrganizer initial={{ id: doc.id, name: doc.filename, bytes }} onSaveVersion={savePages} />
        : inspecting ? <PdfTextInspector bytes={bytes} /> : filling ? <PdfFormEditor bytes={bytes} name={doc.filename} onSaveVersion={saveMarkup} /> : <MarkupEditor bytes={bytes} name={doc.filename} onSaveVersion={saveMarkup} />) : <p className="text-muted-foreground">Loading…</p>}
    </div>
  );
}
