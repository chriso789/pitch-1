import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useEffectiveTenantId } from "@/hooks/useEffectiveTenantId";
import { PageOrganizer, type SaveResult } from "@/components/pdf-pages/PageOrganizer";
import { isPageToolsEnabled } from "@/lib/pdf-pages/featureGate";
import type { SourcePdf } from "@/lib/pdf-pages/pageOps";

const db = supabase as any;

/** Organize pages of a commercial drawing set and save the result as a new document version. */
export default function PlanPagesPage() {
  const { id: projectId, documentId } = useParams();
  const tenantId = useEffectiveTenantId();
  const [doc, setDoc] = useState<any>(null);
  const [src, setSrc] = useState<SourcePdf | null>(null);

  useEffect(() => {
    if (!documentId || !tenantId) return;
    (async () => {
      const { data: d } = await db.from("documents").select("id, filename, file_path, metadata").eq("id", documentId).eq("tenant_id", tenantId).maybeSingle();
      if (!d) return toast.error("Drawing not found for this company");
      if (d.metadata?.commercial_project_id && d.metadata.commercial_project_id !== projectId) return toast.error("This drawing belongs to a different project");
      const { data: blob, error } = await supabase.storage.from("documents").download(d.file_path);
      if (error || !blob) return toast.error("Could not open the drawing file");
      setDoc(d); setSrc({ id: d.id, name: d.filename, bytes: new Uint8Array(await blob.arrayBuffer()) });
    })();
  }, [documentId, tenantId, projectId]);

  const save = async (r: SaveResult) => {
    if (!tenantId || !doc) throw new Error("No company selected");
    const root = doc.metadata?.pages_from_document_id ?? doc.id;
    const { count } = await db.from("documents").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId).contains("metadata", { pages_from_document_id: root });
    const version = (count || 0) + 1;
    const path = `${tenantId}/commercial/${projectId}/drawings/versions/${root}-pages-v${version}-${Date.now()}.pdf`;
    const { error: up } = await supabase.storage.from("documents").upload(path, new Blob([r.bytes as BlobPart], { type: "application/pdf" }), { contentType: "application/pdf", upsert: false });
    if (up) throw up;
    const base = doc.filename.replace(/\.pdf$/i, "").replace(/ \(pages v\d+\)$/, "");
    const { error } = await db.from("documents").insert({ tenant_id: tenantId, filename: `${base} (pages v${version}).pdf`, file_path: path, file_size: r.bytes.byteLength, mime_type: "application/pdf", document_type: "commercial_drawings",
      description: `Page edits v${version}: ${r.summary}`,
      metadata: { commercial_project_id: projectId, category: "drawings", pages_from_document_id: root, edited_from_document_id: doc.id, pages_version: version, page_map: r.pageMap } });
    if (error) { await supabase.storage.from("documents").remove([path]); throw error; }
    toast.success(`Saved "${base} (pages v${version})". The original drawing is unchanged.`);
  };

  if (!isPageToolsEnabled()) return <div className="p-10 text-center text-muted-foreground">Page tools are still being verified and aren't switched on for this site yet.</div>;
  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-3"><Link to={`/commercial/${projectId}`} className="text-sm inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />Project</Link>
        <h1 className="text-xl font-semibold truncate">Organize pages · {doc?.filename ?? "Loading…"}</h1></div>
      <p className="text-xs text-muted-foreground">Measurements and drawing scales stay with the original. Saved versions record which original sheet each page came from; scales on rotated, cropped or resized sheets must be re-verified before measuring the new version.</p>
      {src ? <PageOrganizer initial={src} onSaveVersion={save} /> : <p className="text-muted-foreground">Loading drawing…</p>}
    </div>
  );
}
