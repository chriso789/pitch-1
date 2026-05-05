export type MeasurementInput = {
  roof_area: number;
  squares: number;
  pitch: number;
  facets: number;
  eaves: number;
  rakes: number;
  valleys: number;
  hips: number;
  ridges: number;
  step_flashing: number;
};

export type CarrierLineItem = {
  code?: string;
  description: string;
  quantity?: number;
  unit?: string;
};

export type SupplementDispute = {
  dispute_type: "missing_item" | "quantity_dispute" | "code_upgrade" | "scope_clarification";
  xactimate_code?: string;
  description: string;
  carrier_quantity?: number;
  requested_quantity?: number;
  unit?: string;
  reason: string;
};

const hasItem = (items: CarrierLineItem[], keywords: string[]) =>
  items.some((item) => {
    const text = `${item.code ?? ""} ${item.description}`.toLowerCase();
    return keywords.some((kw) => text.includes(kw.toLowerCase()));
  });

export function generateSupplementDisputes(
  measurements: MeasurementInput,
  carrierItems: CarrierLineItem[]
): SupplementDispute[] {
  const disputes: SupplementDispute[] = [];
  const dripEdgeQty = measurements.eaves + measurements.rakes;
  const ridgeQty = measurements.hips + measurements.ridges;

  if (!hasItem(carrierItems, ["drip edge", "metal edge", "d-style", "edge metal"])) {
    disputes.push({ dispute_type: "missing_item", xactimate_code: "RFG DRIP", description: "Drip edge / edge metal", requested_quantity: dripEdgeQty, unit: "LF", reason: "Roof measurement report includes eave/rake perimeter requiring edge metal." });
  }
  if (!hasItem(carrierItems, ["starter", "starter strip"])) {
    disputes.push({ dispute_type: "missing_item", xactimate_code: "RFG START", description: "Starter shingle course", requested_quantity: dripEdgeQty, unit: "LF", reason: "Starter course required along eaves/rakes for proper wind resistance." });
  }
  if (!hasItem(carrierItems, ["ridge cap", "hip and ridge", "cap shingle"])) {
    disputes.push({ dispute_type: "missing_item", xactimate_code: "RFG RIDGE", description: "Hip and ridge cap shingles", requested_quantity: ridgeQty, unit: "LF", reason: "Hips and ridges require separate cap material and installation." });
  }
  if (measurements.valleys > 0 && !hasItem(carrierItems, ["valley", "w-valley", "valley metal"])) {
    disputes.push({ dispute_type: "missing_item", xactimate_code: "RFG VALLEY", description: "Valley metal / valley treatment", requested_quantity: measurements.valleys, unit: "LF", reason: "Valley runs require valley treatment as part of the roof system." });
  }
  if (measurements.step_flashing > 0 && !hasItem(carrierItems, ["step flashing", "flashing"])) {
    disputes.push({ dispute_type: "missing_item", xactimate_code: "RFG FLASH", description: "Step flashing", requested_quantity: measurements.step_flashing, unit: "LF", reason: "Wall/roof intersections require flashing treatment." });
  }
  if (!hasItem(carrierItems, ["permit"])) {
    disputes.push({ dispute_type: "missing_item", xactimate_code: "PERMIT", description: "Roofing permit allowance", requested_quantity: 1, unit: "EA", reason: "Roof replacement requires permitting in applicable jurisdictions." });
  }
  if (!hasItem(carrierItems, ["dump", "debris", "haul", "disposal"])) {
    disputes.push({ dispute_type: "missing_item", xactimate_code: "DEBRIS", description: "Debris removal / disposal", requested_quantity: 1, unit: "EA", reason: "Tear-off generates debris requiring removal and disposal." });
  }
  if (measurements.pitch >= 7 && !hasItem(carrierItems, ["steep", "high charge"])) {
    disputes.push({ dispute_type: "missing_item", xactimate_code: "RFG STEEP", description: "Steep roof charge", requested_quantity: measurements.squares, unit: "SQ", reason: "Pitch meets steep-slope conditions requiring additional labor and safety." });
  }
  if (measurements.facets >= 20 && !hasItem(carrierItems, ["additional labor", "complex", "cut up"])) {
    disputes.push({ dispute_type: "scope_clarification", description: "Complex roof labor consideration", requested_quantity: measurements.squares, unit: "SQ", reason: "High facet count indicates increased cutting, staging, and detail work." });
  }
  return disputes;
}
