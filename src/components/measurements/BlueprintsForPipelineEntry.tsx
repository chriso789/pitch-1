import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileStack, FlaskConical } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  pipelineEntryId: string;
}

interface PlanDoc {
  id: string;
  file_name: string;
  page_count: number | null;
  status: string;
  created_at: string;
}

/**
 * Lists blueprint documents already uploaded to this pipeline entry / project
 * and exposes deep-links into the Blueprint Lab. Renders nothing when there
 * are no blueprints, so it stays out of the way until one is uploaded.
 */
export function BlueprintsForPipelineEntry({ pipelineEntryId }: Props) {
  const [docs, setDocs] = useState<PlanDoc[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data } = await supabase
        .from("plan_documents")
        .select("id,file_name,page_count,status,created_at")
        .eq("pipeline_entry_id", pipelineEntryId)
        .order("created_at", { ascending: false })
        .limit(10);
      if (!cancelled) setDocs((data as PlanDoc[]) || []);
    }
    load();
    const channel = supabase
      .channel(`pipeline-blueprints-${pipelineEntryId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "plan_documents",
          filter: `pipeline_entry_id=eq.${pipelineEntryId}`,
        },
        () => load(),
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [pipelineEntryId]);

  if (docs.length === 0) return null;

  return (
    <div className="w-full rounded-md border bg-muted/30 p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <FileStack className="h-4 w-4 text-primary" />
          Blueprints on this project ({docs.length})
        </div>
        <Button asChild size="sm" variant="outline">
          <Link to="/blueprint-lab">
            <FlaskConical className="h-4 w-4 mr-1" /> Open Blueprint Lab
          </Link>
        </Button>
      </div>
      <ul className="space-y-1.5">
        {docs.map((d) => (
          <li
            key={d.id}
            className="flex items-center justify-between gap-2 text-sm bg-background rounded px-2 py-1.5"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{d.file_name}</div>
              <div className="text-xs text-muted-foreground flex gap-2">
                <Badge variant="secondary" className="text-[10px]">
                  {d.status}
                </Badge>
                <span>{d.page_count ?? 0} pages</span>
              </div>
            </div>
            <Button asChild size="sm" variant="ghost">
              <Link to={`/blueprints/${d.id}`}>Open</Link>
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
