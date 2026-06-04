import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Roof Perimeter Candidate hook — surfaces the offset-candidate set produced
 * by the mskill `create_roof_edge_candidates` executor.
 *
 * Terminology:
 *   building_footprint        = wall-line / county GIS footprint (anchor)
 *   roof_perimeter_candidate  = estimated roof edge incl. eave/rake overhang
 *   final_roof_perimeter      = only after DSM / point-cloud refinement
 */

export type RoofPerimeterCandidate = {
  id: string;
  measurement_job_id: string | null;
  measurement_request_id: string | null;
  building_footprint_id: string | null;
  source_type: string;
  offset_ft: number | null;
  uniform_offset_ft: number | null;
  effective_offset_ft: number | null;
  eave_offset_ft: number | null;
  rake_offset_ft: number | null;
  area_sqft: number | null;
  perimeter_ft: number | null;
  delta_area_sqft: number | null;
  delta_perimeter_ft: number | null;
  confidence: number | null;
  is_selected: boolean | null;
  status: string | null;
  validation_source: string | null;
  porch_extension_detected: boolean | null;
  lanai_extension_detected: boolean | null;
  attached_patios_detected: boolean | null;
  roof_perimeter_geojson: unknown;
  base_building_footprint_geojson: unknown;
  created_at: string;
  updated_at: string;
};

export const PERIMETER_CANDIDATE_KEY = (jobId?: string | null) =>
  ["mskill", "roof_perimeter_candidates", jobId ?? "none"] as const;

export function useRoofPerimeterCandidates(measurementJobId?: string | null) {
  return useQuery({
    queryKey: PERIMETER_CANDIDATE_KEY(measurementJobId),
    enabled: !!measurementJobId,
    queryFn: async (): Promise<RoofPerimeterCandidate[]> => {
      const { data, error } = await supabase
        .from("roof_perimeter_candidates" as never)
        .select("*")
        .eq("measurement_job_id" as never, measurementJobId as never)
        .order("source_type", { ascending: true })
        .order("effective_offset_ft", { ascending: true });
      if (error) throw error;
      return (data as unknown as RoofPerimeterCandidate[]) ?? [];
    },
  });
}

/**
 * Mark a candidate as selected. Clears `is_selected` on siblings of the same
 * job, then sets it on the chosen row. Writes status='selected'.
 */
export function useSelectRoofPerimeterCandidate(measurementJobId?: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (candidateId: string) => {
      if (!measurementJobId) throw new Error("measurement_job_id is required");
      // Clear siblings.
      const { error: clearErr } = await supabase
        .from("mskill_roof_edge_candidates")
        .update({ is_selected: false, status: "proposed" })
        .eq("mskill_job_id", measurementJobId);
      if (clearErr) throw clearErr;
      // Set selection.
      const { error: setErr } = await supabase
        .from("mskill_roof_edge_candidates")
        .update({ is_selected: true, status: "selected" })
        .eq("id", candidateId);
      if (setErr) throw setErr;
      return { candidateId };
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: PERIMETER_CANDIDATE_KEY(measurementJobId) }),
  });
}

export function useMarkRoofPerimeterCandidateStatus(measurementJobId?: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ candidateId, status }: { candidateId: string; status: "needs_review" | "rejected" | "proposed" }) => {
      const { error } = await supabase
        .from("mskill_roof_edge_candidates")
        .update({ status })
        .eq("id", candidateId);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: PERIMETER_CANDIDATE_KEY(measurementJobId) }),
  });
}
