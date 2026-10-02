import { describe, it, expect } from "vitest";
import { sumLines, groupByCostCode, margin, defaultCostType } from "../budget";

describe("commercial budget helpers", () => {
  const lines = [
    { cost_code_id: "a", cost_type: "material", original_budget: 180000.1, revised_budget: 180000.1, revised_revenue: 220000, projected_gross_profit: 39999.9 },
    { cost_code_id: "a", cost_type: "labor", original_budget: 145000.2, revised_budget: 145000.2, revised_revenue: 170000, projected_gross_profit: 24999.8 },
    { cost_code_id: null, cost_type: "general_conditions", original_budget: 5000, revised_budget: 5000, revised_revenue: 6000, projected_gross_profit: 1000 },
  ];
  it("totals reconcile to the cent", () => {
    const t = sumLines(lines);
    expect(t.original_budget).toBe(330000.3);
    expect(t.revised_revenue).toBe(396000);
    expect(t.projected_gross_profit).toBe(65999.7);
  });
  it("groups by cost code with unassigned last", () => {
    const g = groupByCostCode(lines, { a: { code: "07 54 23", name: "TPO Roofing" } });
    expect(g.map((x) => x.code)).toEqual(["07 54 23", "—"]);
    expect(g[0].lines).toHaveLength(2);
  });
  it("margin and cost type defaults", () => {
    expect(margin(0, 5)).toBe(0);
    expect(margin(100, 25)).toBe(0.25);
    expect(defaultCostType("subcontract")).toBe("subcontract");
    expect(defaultCostType("weird")).toBe("other");
  });
});
