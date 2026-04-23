import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { BlueprintUploadCard } from "@/components/blueprint/BlueprintUploadCard";
import { BlueprintDocumentTable } from "@/components/blueprint/BlueprintDocumentTable";

export default function BlueprintLab() {
  const [docs, setDocs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const loadDocs = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("plan_documents")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    setDocs(data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    loadDocs();
    const channel = supabase
      .channel("blueprint-lab-docs")
      .on("postgres_changes", { event: "*", schema: "public", table: "plan_documents" }, () => loadDocs())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadDocs]);

  return (
    <div className="container mx-auto p-6 space-y-6">
      <header>
        <h1 className="text-3xl font-bold">Blueprint Lab</h1>
        <p className="text-muted-foreground">
          Upload roof blueprint PDFs, classify pages, extract geometry, specs, and detail references.
        </p>
      </header>

      <BlueprintUploadCard onUploaded={loadDocs} />
      <BlueprintDocumentTable documents={docs} loading={loading} onRefresh={loadDocs} />
    </div>
  );
}
