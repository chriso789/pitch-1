import { describe, it, expect } from "vitest";
import { buyoutGain, adjustedTotal } from "../buyout";

describe("buyout math", () => {
  it("uses committed cost when present", () => {
    expect(buyoutGain(125000, 117000, 119000)).toEqual({ value: 8000, basis: "committed" });
  });
  it("falls back to the selected quote", () => {
    expect(buyoutGain(125000, 0, 130500.55)).toEqual({ value: -5500.55, basis: "selected" });
  });
  it("is empty with nothing selected", () => {
    expect(buyoutGain(125000, 0, null).value).toBeNull();
  });
  it("adjusted total adds freight, tax, alternates", () => {
    expect(adjustedTotal({ amount: 100000.1, freight: 2500, tax: 7000.2, alternates_amount: -1500 })).toBe(108000.3);
  });
});
