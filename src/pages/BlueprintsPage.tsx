import { useEffect, useState, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { useActiveTenantId } from "@/hooks/useActiveTenantId";
import { Upload, FileText, Loader2 } from "lucide-react";

interface PlanDoc {
  id: string;
  file_name: string;
  status: string;
  status_message: string | null;
  page_count: number;
  property_address: string | null;
  created_at: string;
}

const STATUS_VARIANT: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  uploaded: "secondary",
  classifying: "secondary",
  extracting_geometry: "secondary",
  extracting_specs: "secondary",
  linking_details: "secondary",
  ready_for_review: "default",
  approved: "default",
  rejected: "destructive",
  failed: "destructive",
};

export default function BlueprintsPage() {
  const navigate = useNavigate();
  const tenantId = useActiveTenantId();
  const [docs, setDocs] = useState<PlanDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [address, setAddress] = useState("");

  const loadDocs = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("plan_documents")
      .select("id, file_name, status, status_message, page_count, property_address, created_at")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) {
      toast({ title: "Failed to load", description: error.message, variant: "destructive" });
    } else {
      setDocs((data || []) as PlanDoc[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadDocs();
    const channel = supabase
      .channel("plan-docs-list")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "plan_documents" },
        () => loadDocs()
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadDocs]);

  const handleUpload = async (file: File) => {
    if (!tenantId) {
      toast({ title: "No tenant", description: "Cannot upload without an active company", variant: "destructive" });
      return;
    }
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      toast({ title: "PDF only", description: "Please upload a PDF file", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const docId = crypto.randomUUID();
      const path = `${tenantId}/${docId}/${file.name}`;
      const { error: upErr } = await supabase.storage.from("blueprints").upload(path, file, {
        contentType: "application/pdf",
        upsert: false,
      });
      if (upErr) throw upErr;

      const { data: { user } } = await supabase.auth.getUser();
      const { error: insErr } = await supabase.from("plan_documents").insert({
        id: docId,
        tenant_id: tenantId,
        uploaded_by: user?.id,
        file_name: file.name,
        file_path: path,
        property_address: address || null,
        status: "uploaded",
      });
      if (insErr) throw insErr;

      const { error: fnErr } = await supabase.functions.invoke("parse-blueprint-document", {
        body: { document_id: docId },
      });
      if (fnErr) throw fnErr;

      toast({ title: "Uploaded", description: "Parsing started" });
      setAddress("");
      loadDocs();
    } catch (e: any) {
      toast({ title: "Upload failed", description: e.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Blueprint Parser</h1>
          <p className="text-muted-foreground">Upload roof blueprints to extract geometry, specs, and details</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" /> Upload blueprint PDF
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            placeholder="Property address (optional)"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
          <div className="flex items-center gap-3">
            <Input
              type="file"
              accept="application/pdf"
              disabled={uploading}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleUpload(f);
                e.target.value = "";
              }}
            />
            {uploading && <Loader2 className="h-5 w-5 animate-spin" />}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent uploads</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : docs.length === 0 ? (
            <p className="text-muted-foreground">No blueprints uploaded yet.</p>
          ) : (
            <div className="divide-y">
              {docs.map((d) => (
                <Link
                  key={d.id}
                  to={`/blueprints/${d.id}`}
                  className="flex items-center justify-between py-3 hover:bg-muted/40 px-2 rounded transition"
                >
                  <div className="flex items-start gap-3">
                    <FileText className="h-5 w-5 mt-0.5 text-muted-foreground" />
                    <div>
                      <div className="font-medium">{d.file_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {d.property_address || "—"} · {d.page_count} pages ·{" "}
                        {new Date(d.created_at).toLocaleString()}
                      </div>
                      {d.status_message && (
                        <div className="text-xs text-muted-foreground italic">{d.status_message}</div>
                      )}
                    </div>
                  </div>
                  <Badge variant={STATUS_VARIANT[d.status] || "outline"}>
                    {d.status.replaceAll("_", " ")}
                  </Badge>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
