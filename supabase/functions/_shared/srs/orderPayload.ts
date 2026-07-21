// Pure SRS submit-order payload builder.
//
// The shape is the QA-verified production contract (2026 QA run:
// OAuth → validate → submit → real Order ID → webhook → audit). Any change
// here breaks the snapshot test in
// supabase/functions/srs-api-proxy/__tests__/submit-payload.snapshot.test.ts
// on purpose. Do NOT edit without SRS sign-off.

export type SrsShipTo = {
  name?: string;
  addressLine1?: string; addressLine2?: string; addressLine3?: string;
  city?: string; state?: string; zipCode?: string;
};

export type SrsCustomerContact = {
  customerContactName?: string;
  customerContactPhone?: string;
  customerContactEmail?: string;
  customerContactAddress?: {
    addressLine1?: string; city?: string; state?: string; zipCode?: string;
  };
  additionalContactEmails?: string[];
};

export type SrsLineItem = {
  productId: number | string;
  productName?: string;
  option?: string;
  quantity: number;
  price?: number;   // intentionally accepted but NEVER serialized
  uom: string;
  customerItem?: string;
};

export function normalizeUom(raw: string | null | undefined): string {
  const v = String(raw || "EA").trim().toUpperCase();
  const map: Record<string, string> = {
    "EACH": "EA", "EA.": "EA", "PC": "PC", "PCS": "PC",
    "PIECE": "EA", "PIECES": "EA", "UNIT": "EA", "UNITS": "EA",
    "BOX": "BX", "BOXES": "BX",
    "BUNDLE": "BD", "BUNDLES": "BD", "BDLS": "BD", "BDL": "BD", "BD": "BD",
    "ROLL": "RL", "ROLLS": "RL",
    "SQUARE": "SQ", "SQUARES": "SQ", "SQS": "SQ",
    "SHEET": "SHT", "SHEETS": "SHT",
    "LINEAL FOOT": "LF", "LINEAR FOOT": "LF",
    "LINEAL FEET": "LF", "LINEAR FEET": "LF",
    "LFT": "LF", "FT": "LF", "FOOT": "LF", "FEET": "LF",
    "GAL": "GA", "GALLON": "GA", "GALLONS": "GA",
    "PAIL": "PL", "PAILS": "PL",
    "BAG": "BG", "BAGS": "BG",
    "TUBE": "TB", "TUBES": "TB",
  };
  return map[v] || v;
}

export function buildSubmitOrderPayload(args: {
  sourceSystem: string;
  customerCode: string;
  accountNumber?: string | null;
  jobAccountNumber?: number | null;
  shipToSequenceNumber?: number;
  branchCode: string;
  poNumber: string;
  reference?: string | null;
  jobNumber?: string | null;
  orderDate?: string | null;
  expectedDeliveryDate?: string | null;
  expectedDeliveryTime?: string | null;
  orderType?: "WHSE" | "WILLCALL";
  shippingMethod: string;
  shipTo?: SrsShipTo | null;
  customerContact?: SrsCustomerContact | null;
  notes?: string | null;
  items: SrsLineItem[];
}): Record<string, unknown> {
  const today = new Date().toISOString().slice(0, 10);
  const payload: Record<string, unknown> = {
    sourceSystem: args.sourceSystem,
    customerCode: args.customerCode,
    shipToSequenceNumber: args.shipToSequenceNumber ?? 1,
    branchCode: args.branchCode,
    accountNumber: String(args.accountNumber ?? args.customerCode ?? "").trim(),
    transactionID: crypto.randomUUID(),
    transactionDate: new Date().toISOString(),
    notes: args.notes ?? "",
    shipTo: args.shipTo ?? {
      addressLine1: "", addressLine2: "", addressLine3: "",
      city: "", state: "", zipCode: "",
    },
    poDetails: {
      poNumber: args.poNumber,
      reference: args.reference ?? "",
      jobNumber: args.jobNumber ?? "",
      orderDate: args.orderDate ?? today,
      expectedDeliveryDate: args.expectedDeliveryDate ?? today,
      expectedDeliveryTime: args.expectedDeliveryTime ?? "Anytime",
      orderType: args.orderType ?? "WHSE",
      shippingMethod: args.shippingMethod,
    },
    // NOTE: submit payload never includes `price` on line items — SRS prices
    // server-side from their catalog; sending price triggers drops.
    orderLineItemDetails: args.items.map((i) => {
      const numericId = Number(i.productId);
      return {
        productId: Number.isFinite(numericId) ? numericId : i.productId,
        productName: i.productName ?? "",
        option: i.option ?? "N/A",
        quantity: Number(i.quantity),
        uom: normalizeUom(i.uom),
        customerItem: i.customerItem ?? "",
      };
    }),
    customerContactInfo: args.customerContact ?? {},
  };
  // NOTE: top-level `jobAccountNumber` intentionally omitted — SRS resolves
  // the JAN from customerCode + shipToSequenceNumber.
  return payload;
}
