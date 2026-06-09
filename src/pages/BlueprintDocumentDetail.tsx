import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2, Workflow } from "lucide-react";
import { extractRoofPlanGeometry, getBlueprintDocument } from "@/integrations/blueprintApi";
import {
  importBlueprintFromPlanDocument,
  findWorkbenchSessionByPlanDocument,
} from "@/integrations/blueprintImporterV2Api";
import { BlueprintPageList } from "@/components/blueprint/BlueprintPageList";
import { BlueprintSpecsPanel } from "@/components/blueprint/BlueprintSpecsPanel";
import { toast } from "@/hooks/use-toast";

export default function BlueprintDocumentDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const result = await getBlueprintDocument(id);
      setData(result);
    } catch (e: any) {
      toast({ title: "Failed to load", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  async function openWorkbench() {
    setOpening(true);
    try {
      // Reuse existing session if present, otherwise run import.
      const documentTenantId = data?.document?.tenant_id as string | undefined;
      const existing = await findWorkbenchSessionByPlanDocument(id, documentTenantId);
      let sessionId = existing.session_id;
      if (!sessionId) {
        const created = await importBlueprintFromPlanDocument(id, documentTenantId);
        sessionId = created.session_id;
        if (created.manual_measurement_required) {
          toast({
            title: "Workbench opened in manual measurement mode",
            description: "This document doesn't have deterministic takeoff. Use the workbench to enter measurements manually.",
          });
        }
      }
      navigate(`/blueprint-importer-v2/${sessionId}`);
    } catch (e: any) {
      toast({ title: "Failed to open workbench", description: e.message, variant: "destructive" });
    } finally {
      setOpening(false);
    }
  }

  if (loading) return <div className="p-6 flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>;
  if (!data) return <div className="p-6">Document not found.</div>;

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="sm">
            <Link to="/blueprint-lab"><ArrowLeft className="h-4 w-4 mr-1" /> Back</Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold">{data.document.file_name}</h1>
            <p className="text-sm text-muted-foreground">{data.document.property_address || "No address"}</p>
          </div>
        </div>
        <Button onClick={openWorkbench} disabled={opening}>
          {opening ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Workflow className="h-4 w-4 mr-2" />}
          Open Trade Quote Workbench
        </Button>
      </div>

      <BlueprintPageList
        pages={data.pages}
        onExtractGeometry={async (pageId) => {
          await extractRoofPlanGeometry({ page_id: pageId });
          toast({ title: "Geometry extraction queued" });
          await load();
        }}
      />

      <BlueprintSpecsPanel specs={data.specs} />
    </div>
  );
}
