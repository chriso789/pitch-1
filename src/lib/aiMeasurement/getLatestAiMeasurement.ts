import { supabase } from "@/integrations/supabase/client";

export async function getLatestAiMeasurement({
  recordId,
  recordType,
}: {
  recordId: string;
  recordType: "lead" | "project";
}) {
  const column = recordType === "lead" ? "lead_id" : "project_id";

  const { data: job, error: jobError } = await (supabase as any)
    .from("ai_measurement_jobs")
    .select("*")
    .eq(column, recordId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (jobError) throw jobError;
  if (!job) return null;

  const [{ data: result }, { data: planes }, { data: edges }, { data: checks }] =
    await Promise.all([
      (supabase as any)
        .from("ai_measurement_results")
        .select("*")
        .eq("job_id", job.id)
        .maybeSingle(),
      (supabase as any)
        .from("ai_roof_planes")
        .select("*")
        .eq("job_id", job.id)
        .order("plane_index", { ascending: true }),
      (supabase as any).from("ai_roof_edges").select("*").eq("job_id", job.id),
      (supabase as any)
        .from("ai_measurement_quality_checks")
        .select("*")
        .eq("job_id", job.id),
    ]);

  return {
    job,
    result: result || null,
    planes: planes || [],
    edges: edges || [],
    checks: checks || [],
  };
}
