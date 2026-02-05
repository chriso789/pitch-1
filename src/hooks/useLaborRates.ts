import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface LaborRate {
  id: string;
  job_type: string;
  skill_level: string;
  base_rate_per_hour: number;
  location_zone: string | null;
  seasonal_adjustment: number;
  complexity_multiplier: number;
  effective_date: string;
  expires_date: string | null;
  is_active: boolean;
}

export const LABOR_JOB_TYPES = [
  "Roofing Installation",
  "Roofing Repair",
  "Tear-Off Only",
  "Gutter Install",
  "Gutter Repair",
  "Siding Install",
  "Siding Repair",
  "Flashing & Trim",
  "General Labor"
] as const;

export const LABOR_SKILL_LEVELS = [
  "Apprentice",
  "Journeyman",
  "Master",
  "Foreman"
] as const;

export const LABOR_FORMULA_PRESETS = [
  {
    name: "Per Square Installation",
    formula: "{{ measure.surface_squares }} * 2.5",
    description: "2.5 hours per roofing square",
    estimatedHoursPerUnit: 2.5
  },
  {
    name: "Tear-Off Labor",
    formula: "{{ measure.surface_squares }} * 1.5",
    description: "1.5 hours per square for tear-off",
    estimatedHoursPerUnit: 1.5
  },
  {
    name: "Per LF Gutter",
    formula: "{{ measure.eave_lf }} * 0.15",
    description: "0.15 hours per linear foot",
    estimatedHoursPerUnit: 0.15
  },
  {
    name: "Ridge/Hip Work",
    formula: "({{ measure.ridge_lf }} + {{ measure.hip_lf }}) * 0.25",
    description: "0.25 hours per LF for ridge/hip",
    estimatedHoursPerUnit: 0.25
  },
  {
    name: "Valley Work",
    formula: "{{ measure.valley_lf }} * 0.35",
    description: "0.35 hours per valley LF",
    estimatedHoursPerUnit: 0.35
  },
  {
    name: "Perimeter Trim",
    formula: "{{ measure.perimeter_lf }} * 0.1",
    description: "0.1 hours per perimeter LF",
    estimatedHoursPerUnit: 0.1
  }
] as const;

export function useLaborRates() {
  return useQuery({
    queryKey: ["labor-rates"],
    queryFn: async () => {
      const today = new Date().toISOString().split("T")[0];
      
      const { data, error } = await supabase
        .from("labor_rates")
        .select("*")
        .eq("is_active", true)
        .lte("effective_date", today)
        .or(`expires_date.is.null,expires_date.gte.${today}`)
        .order("job_type")
        .order("skill_level");

      if (error) throw error;
      return (data || []) as LaborRate[];
    },
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

export function calculateEffectiveRate(rate: LaborRate): number {
  return rate.base_rate_per_hour * rate.complexity_multiplier * rate.seasonal_adjustment;
}

export function evaluateLaborFormula(
  formula: string,
  measurements: Record<string, number | undefined>
): number {
  try {
    let expr = formula;
    // Replace measurement variables with values
    expr = expr.replace(/\{\{\s*measure\.(\w+)\s*\}\}/g, (_, key) => {
      return String(measurements[key] || 0);
    });
    // Evaluate the expression safely
    // eslint-disable-next-line no-eval
    const result = eval(expr);
    return typeof result === "number" && !isNaN(result) ? Math.max(0, result) : 0;
  } catch {
    return 0;
  }
}
