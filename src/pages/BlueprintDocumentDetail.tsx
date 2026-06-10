import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Loader2, Sparkles, Workflow } from "lucide-react";
import {
  describeBlueprintDocument,
  extractRoofPlanGeometry,
  getBlueprintDocument,
} from "@/integrations/blueprintApi";
import {
  importBlueprintFromPlanDocument,
  findWorkbenchSessionByPlanDocument,
} from "@/integrations/blueprintImporterV2Api";
import {
  BlueprintPageList,
  guessTradeFromPage,
} from "@/components/blueprint/BlueprintPageList";
import { BlueprintPerPageBreakdown } from "@/components/blueprint/BlueprintPerPageBreakdown";
import { BlueprintSpecsPanel } from "@/components/blueprint/BlueprintSpecsPanel";
import { toast } from "@/hooks/use-toast";

export default function BlueprintDocumentDetail() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [describing, setDescribing] = useState(false);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [trades, setTrades] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true);
    try {
      const result = await getBlueprintDocument(id);
      setData(result);
      // Seed trade guesses for every page
      const seeded: Record<string, string> = {};
      for (const p of result?.pages ?? []) seeded[p.id] = guessTradeFromPage(p);
      setTrades(seeded);
      setSelected({});
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

  async function generateDescription() {
    setDescribing(true);
    try {
      const result = await describeBlueprintDocument(id);
      if (!result?.ok) throw new Error(result?.error || "AI description failed");
      toast({
        title: "AI description generated",
        description: `Updated ${result.pages_updated ?? 0} pages with summaries.`,
      });
      await load();
    } catch (e: any) {
      toast({ title: "AI description failed", description: e.message, variant: "destructive" });
    } finally {
      setDescribing(false);
    }
  }

  const selectedPages = useMemo(
    () => (data?.pages ?? []).filter((p: any) => selected[p.id]),
    [data, selected],
  );

  const aiDescription = (data?.document?.metadata as any)?.ai_description as string | undefined;
  const aiTrades = ((data?.document?.metadata as any)?.ai_trades_present as string[] | undefined) || [];

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
        <div className="flex gap-2">
          <Button onClick={generateDescription} variant="outline" disabled={describing}>
            {describing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
            {aiDescription ? "Regenerate AI Description" : "Generate AI Description"}
          </Button>
          <Button onClick={openWorkbench} disabled={opening}>
            {opening ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Workflow className="h-4 w-4 mr-2" />}
            Open Trade Quote Workbench
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> AI plan description
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {aiDescription ? (
            <>
              <p className="text-sm whitespace-pre-wrap leading-relaxed">{aiDescription}</p>
              {aiTrades.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {aiTrades.map((t) => (
                    <Badge key={t} variant="secondary" className="capitalize">{t}</Badge>
                  ))}
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              No AI description yet. Click <strong>Generate AI Description</strong> to summarize what
              these blueprints cover, identify the trades present, and back-fill missing page titles
              and scales.
            </p>
          )}
        </CardContent>
      </Card>

      <BlueprintPageList
        pages={data.pages}
        selected={selected}
        onToggle={(pageId, v) => setSelected((s) => ({ ...s, [pageId]: v }))}
        onToggleAll={(v) => {
          const next: Record<string, boolean> = {};
          if (v) for (const p of data.pages) next[p.id] = true;
          setSelected(next);
        }}
        trades={trades}
        onTradeChange={(pageId, trade) => setTrades((t) => ({ ...t, [pageId]: trade }))}
        onExtractGeometry={async (pageId) => {
          await extractRoofPlanGeometry({ page_id: pageId });
          toast({ title: "Geometry extraction queued" });
          await load();
        }}
      />

      <BlueprintPerPageBreakdown
        pages={selectedPages}
        trades={trades}
        dimensions={data.dimensions ?? []}
        geometry={data.geometry ?? []}
        pitchNotes={data.pitch_notes ?? []}
        detailRefs={data.detail_refs ?? []}
      />

      <BlueprintSpecsPanel specs={data.specs} />
    </div>
  );
}
