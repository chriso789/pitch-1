export const COST_TYPES = ["material", "labor", "equipment", "subcontract", "other", "general_conditions"] as const;
export const COST_TYPE_LABEL: Record<string, string> = {
  material: "Material", labor: "Labor", equipment: "Equipment", subcontract: "Subcontract", other: "Other", general_conditions: "General conditions",
};

export const NUM_COLS = [
  "original_budget", "approved_budget_changes", "revised_budget", "pending_commitments", "committed_cost",
  "actual_cost", "projected_final_cost", "variance", "revised_revenue", "projected_gross_profit",
] as const;
export type NumCol = (typeof NUM_COLS)[number];

const r2 = (n: number) => Math.round(n * 100) / 100;

export function sumLines(lines: any[]): Record<NumCol, number> {
  const out = Object.fromEntries(NUM_COLS.map((c) => [c, 0])) as Record<NumCol, number>;
  for (const l of lines) for (const c of NUM_COLS) out[c] = r2(out[c] + Number(l[c] || 0));
  return out;
}

export const margin = (rev: number, gp: number) => (rev ? gp / rev : 0);

/** Group budget lines by cost code (null code => "Unassigned"), sorted by code. */
export function groupByCostCode(lines: any[], codes: Record<string, any>) {
  const groups = new Map<string, { key: string; code: string; name: string; lines: any[] }>();
  for (const l of lines) {
    const cc = l.cost_code_id ? codes[l.cost_code_id] : null;
    const key = l.cost_code_id || "unassigned";
    if (!groups.has(key)) groups.set(key, { key, code: cc?.code || "—", name: cc?.name || "Unassigned", lines: [] });
    groups.get(key)!.lines.push(l);
  }
  return [...groups.values()].sort((a, b) => (a.key === "unassigned" ? 1 : b.key === "unassigned" ? -1 : a.code.localeCompare(b.code)));
}

/** Default cost type for an estimate line kind. */
export const defaultCostType = (kind: string) => (COST_TYPES as readonly string[]).includes(kind) ? kind : "other";
