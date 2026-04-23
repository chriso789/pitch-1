import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { reviewBlueprintPage } from "@/integrations/blueprintApi";
import { BlueprintGeometryPanel } from "@/components/blueprint/BlueprintGeometryPanel";
import { BlueprintCalloutPanel } from "@/components/blueprint/BlueprintCalloutPanel";
import { BlueprintReviewActions } from "@/components/blueprint/BlueprintReviewActions";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";

export default function BlueprintPageReview() {
  const { id = "" } = useParams();
  const [page, setPage] = useState<any>(null);
  const [geometry, setGeometry] = useState<any[]>([]);
  const [dimensions, setDimensions] = useState<any[]>([]);
  const [pitchNotes, setPitchNotes] = useState<any[]>([]);
  const [detailRefs, setDetailRefs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const [{ data: p }, { data: g }, { data: d }, { data: pn }, { data: refs }] = await Promise.all([
      supabase.from("plan_pages").select("*").eq("id", id).maybeSingle(),
      supabase.from("plan_geometry").select("*").eq("page_id", id),
      supabase.from("plan_dimensions").select("*").eq("page_id", id),
      supabase.from("plan_pitch_notes").select("*").eq("page_id", id),
      supabase.from("plan_detail_refs").select("*").eq("source_page_id", id),
    ]);
    setPage(p);
    setGeometry(g || []);
    setDimensions(d || []);
    setPitchNotes(pn || []);
    setDetailRefs(refs || []);
    setLoading(false);
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  const publicUrl = useMemo(() => {
    if (!page?.image_path) return "";
    return supabase.storage.from("blueprint-pages").getPublicUrl(page.image_path).data.publicUrl;
  }, [page]);

  if (loading) return <div className="p-6 flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;
  if (!page) return <div className="p-6">Page not found.</div>;

  return (
    <div className="container mx-auto p-6 space-y-4">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link to={`/blueprints/${page.document_id}`}><ArrowLeft className="h-4 w-4 mr-1" /> Back to document</Link>
        </Button>
        <div>
          <h1 className="text-xl font-bold">Page {page.page_number} — {page.page_type}</h1>
          <p className="text-sm text-muted-foreground">{page.sheet_number || page.sheet_name || "—"}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-4">
          <div className="border rounded-md bg-muted/30 aspect-[3/4] flex items-center justify-center overflow-hidden">
            {publicUrl ? (
              <img src={publicUrl} alt={`Page ${page.page_number}`} className="w-full h-full object-contain" />
            ) : (
              <p className="text-muted-foreground text-sm">No page image</p>
            )}
          </div>
          <BlueprintReviewActions
            currentStatus={page.review_status}
            onApprove={async () => {
              await reviewBlueprintPage(page.id, "approved");
              toast({ title: "Approved" });
              load();
            }}
            onReject={async () => {
              await reviewBlueprintPage(page.id, "rejected");
              toast({ title: "Rejected" });
              load();
            }}
          />
        </div>

        <div className="space-y-4">
          <BlueprintGeometryPanel geometry={geometry} dimensions={dimensions} pitchNotes={pitchNotes} />
          <BlueprintCalloutPanel refs={detailRefs} />
        </div>
      </div>
    </div>
  );
}
