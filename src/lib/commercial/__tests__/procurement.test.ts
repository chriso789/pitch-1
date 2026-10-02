import { describe, it, expect } from "vitest";
import { daysAtRisk, expectedDelivery } from "../procurement";

describe("procurement risk", () => {
  it("uses PO date + lead time when no vendor date", () => {
    expect(expectedDelivery({ po_date: "2026-10-01", lead_time_days: 30 })).toEqual({ date: "2026-10-31", basis: "lead_time" });
    expect(daysAtRisk({ po_date: "2026-10-01", lead_time_days: 30, required_onsite_date: "2026-10-21" })).toBe(10);
  });
  it("prefers stored vendor dates and actuals", () => {
    expect(daysAtRisk({ expected_delivery_date: "2026-10-15", po_date: "2026-10-01", lead_time_days: 60, required_onsite_date: "2026-10-21" })).toBe(-6);
    expect(expectedDelivery({ delivery_date: "2026-10-02", expected_delivery_date: "2026-10-15" })?.basis).toBe("delivered");
  });
  it("does not guess without data", () => {
    expect(daysAtRisk({ required_onsite_date: "2099-01-01" }, new Date("2026-10-02"))).toBeNull();
    expect(daysAtRisk({ required_onsite_date: "2026-09-30" }, new Date("2026-10-02"))).toBe(2);
    expect(daysAtRisk({ required_onsite_date: "2026-09-30", status: "complete" })).toBeNull();
  });
});
