import { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import { ArrowLeft, Check, X, Loader2, RefreshCw, Pencil, Save } from "lucide-react";

export default function BlueprintReviewPage() {
  const { id } = useParams<{ id: string }>();
  const [doc, setDoc] = useState<any>(null);
  const [pages, setPages] = useState<any[]>([]);
  const [specs, setSpecs] = useState<any[]>([]);
  const [refs, setRefs] = useState<any[]>([]);
  const [dimensions, setDimensions] = useState<any[]>([]);
  const [geometry, setGeometry] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingSpec, setEditingSpec] = useState<string | null>(null);
  const [specEdit, setSpecEdit] = useState<{ key_name: string; value_text: string }>({ key_name: "", value_text: "" });

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const [docRes, pagesRes, specsRes, refsRes, dimsRes, geomRes] = await Promise.all([
      supabase.from("plan_documents").select("*").eq("id", id).single(),
      supabase.from("plan_pages").select("*").eq("document_id", id).order("page_number"),
      supabase.from("plan_specs").select("*").eq("document_id", id).order("category"),
      supabase.from("plan_detail_refs").select("*").eq("document_id", id),
      supabase.from("plan_dimensions").select("*, plan_pages!inner(document_id)").eq("plan_pages.document_id", id),
      supabase.from("plan_geometry").select("*, plan_pages!inner(document_id)").eq("plan_pages.document_id", id),
    ]);
    if (docRes.data) setDoc(docRes.data);
    setPages(pagesRes.data || []);
    setSpecs(specsRes.data || []);
    setRefs(refsRes.data || []);
    setDimensions((dimsRes.data as any[]) || []);
    setGeometry((geomRes.data as any[]) || []);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
    if (!id) return;
    const ch = supabase
      .channel(`plan-doc-${id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "plan_documents", filter: `id=eq.${id}` }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "plan_pages", filter: `document_id=eq.${id}` }, () => load())
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [id, load]);

  const reparse = async () => {
    if (!id) return;
    await supabase.from("plan_documents").update({ status: "uploaded", status_message: null }).eq("id", id);
    const { error } = await supabase.functions.invoke("parse-blueprint-document", { body: { document_id: id } });
    if (error) toast({ title: "Failed", description: error.message, variant: "destructive" });
    else toast({ title: "Re-parsing started" });
  };

  const setStatus = async (status: "approved" | "rejected") => {
    if (!id) return;
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from("plan_documents").update({
      status,
      approved_at: status === "approved" ? new Date().toISOString() : null,
      approved_by: status === "approved" ? user?.id : null,
    }).eq("id", id);
    await supabase.from("plan_review_actions").insert({
      tenant_id: doc.tenant_id,
      document_id: id,
      user_id: user?.id,
      action: status,
    });
    toast({ title: status === "approved" ? "Approved" : "Rejected" });
    load();
  };

  const updateSpec = async (specId: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    await supabase.from("plan_specs").update({
      key_name: specEdit.key_name,
      value_text: specEdit.value_text,
      approved: true,
      edited_by: user?.id,
    }).eq("id", specId);
    setEditingSpec(null);
    load();
  };

  const deleteSpec = async (specId: string) => {
    await supabase.from("plan_specs").delete().eq("id", specId);
    load();
  };

  const updatePageType = async (pageId: string, newType: string) => {
    await supabase.from("plan_pages").update({ page_type: newType as any }).eq("id", pageId);
    load();
  };

  if (loading || !doc) {
    return (
      <div className="container mx-auto p-6 flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  const specsByCategory = specs.reduce<Record<string, any[]>>((acc, s) => {
    (acc[s.category] ||= []).push(s);
    return acc;
  }, {});

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" asChild>
            <Link to="/blueprints"><ArrowLeft className="h-4 w-4" /></Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold">{doc.file_name}</h1>
            <p className="text-sm text-muted-foreground">
              {doc.property_address || "—"} · {doc.page_count} pages
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge>{String(doc.status).split("_").join(" ")}</Badge>
          <Button variant="outline" size="sm" onClick={reparse}>
            <RefreshCw className="h-4 w-4 mr-1" /> Re-parse
          </Button>
          <Button variant="default" size="sm" onClick={() => setStatus("approved")}
            disabled={doc.status === "approved"}>
            <Check className="h-4 w-4 mr-1" /> Approve
          </Button>
          <Button variant="destructive" size="sm" onClick={() => setStatus("rejected")}>
            <X className="h-4 w-4 mr-1" /> Reject
          </Button>
        </div>
      </div>

      <Tabs defaultValue="pages">
        <TabsList>
          <TabsTrigger value="pages">Pages ({pages.length})</TabsTrigger>
          <TabsTrigger value="specs">Specs ({specs.length})</TabsTrigger>
          <TabsTrigger value="dimensions">Dimensions ({dimensions.length})</TabsTrigger>
          <TabsTrigger value="geometry">Geometry ({geometry.length})</TabsTrigger>
          <TabsTrigger value="refs">Detail refs ({refs.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="pages" className="space-y-3">
          {pages.map((p) => (
            <Card key={p.id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">
                    Page {p.page_number}
                    {p.sheet_number && <span className="ml-2 text-muted-foreground">{p.sheet_number}</span>}
                    {p.sheet_name && <span className="ml-2 text-muted-foreground">— {p.sheet_name}</span>}
                  </CardTitle>
                  <select
                    className="text-xs border rounded px-2 py-1 bg-background"
                    value={p.page_type}
                    onChange={(e) => updatePageType(p.id, e.target.value)}
                  >
                    {["roof_plan","detail_sheet","specification_sheet","section_sheet","schedule_sheet","cover_sheet","framing_plan","irrelevant","unknown"].map(t =>
                      <option key={t} value={t}>{t}</option>
                    )}
                  </select>
                </div>
              </CardHeader>
              <CardContent className="text-sm space-y-1">
                {p.scale_text && <div><span className="text-muted-foreground">Scale:</span> {p.scale_text}</div>}
                {p.ai_summary && <p className="text-muted-foreground italic">{p.ai_summary}</p>}
                {p.page_type_confidence != null && (
                  <div className="text-xs text-muted-foreground">
                    Confidence: {Math.round(p.page_type_confidence * 100)}%
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="specs" className="space-y-4">
          {Object.entries(specsByCategory).map(([cat, items]) => (
            <Card key={cat}>
              <CardHeader>
                <CardTitle className="text-base capitalize">{cat.replaceAll("_", " ")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {items.map((s) => (
                  <div key={s.id} className="border rounded p-2 text-sm">
                    {editingSpec === s.id ? (
                      <div className="space-y-2">
                        <Input value={specEdit.key_name} onChange={(e) => setSpecEdit({ ...specEdit, key_name: e.target.value })} placeholder="Key" />
                        <Input value={specEdit.value_text} onChange={(e) => setSpecEdit({ ...specEdit, value_text: e.target.value })} placeholder="Value" />
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => updateSpec(s.id)}><Save className="h-4 w-4 mr-1" /> Save</Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingSpec(null)}>Cancel</Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-medium">{s.key_name}</div>
                          <div className="text-muted-foreground">{s.value_text}</div>
                          {s.approved && <Badge variant="secondary" className="mt-1">approved</Badge>}
                        </div>
                        <div className="flex gap-1">
                          <Button size="icon" variant="ghost" onClick={() => {
                            setEditingSpec(s.id);
                            setSpecEdit({ key_name: s.key_name, value_text: s.value_text || "" });
                          }}><Pencil className="h-4 w-4" /></Button>
                          <Button size="icon" variant="ghost" onClick={() => deleteSpec(s.id)}>
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
          {specs.length === 0 && <p className="text-muted-foreground text-sm">No specs extracted yet.</p>}
        </TabsContent>

        <TabsContent value="dimensions">
          <Card><CardContent className="pt-6">
            {dimensions.length === 0 ? <p className="text-muted-foreground text-sm">No dimensions extracted.</p> : (
              <table className="w-full text-sm">
                <thead><tr className="text-left text-muted-foreground"><th>Label</th><th>Feet</th><th>Confidence</th></tr></thead>
                <tbody>
                  {dimensions.map((d) => (
                    <tr key={d.id} className="border-t"><td>{d.label_text}</td><td>{d.normalized_feet ?? "—"}</td><td>{d.confidence ?? "—"}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="geometry">
          <Card><CardContent className="pt-6">
            {geometry.length === 0 ? <p className="text-muted-foreground text-sm">No geometry extracted yet. (Stage 2 vectorization is a follow-up phase.)</p> : (
              <pre className="text-xs overflow-auto">{JSON.stringify(geometry, null, 2)}</pre>
            )}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="refs">
          <Card><CardContent className="pt-6">
            {refs.length === 0 ? <p className="text-muted-foreground text-sm">No detail references found.</p> : (
              <table className="w-full text-sm">
                <thead><tr className="text-left text-muted-foreground"><th>Callout</th><th>Target sheet</th><th>Linked</th></tr></thead>
                <tbody>
                  {refs.map((r) => (
                    <tr key={r.id} className="border-t">
                      <td>{r.callout_text}</td>
                      <td>{r.target_sheet_number}</td>
                      <td>{r.target_page_id ? "✅" : "❌"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
