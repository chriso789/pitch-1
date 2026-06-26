// Centz frontend helper — calls payment-api routes via edgeApi.
// Phase 1: createCentzInvoiceLink only. Phase 2 helpers stubbed.

import { edgeApi } from "@/lib/edgeApi";

export interface CentzLineInput {
  description?: string;
  product?: { external_id: string; name: string; unit_price: number };
  unit_price: number;
  qty: number;
  total: number;
}

export interface CreateCentzInvoiceLinkInput {
  pitch_id?: string;
  pipeline_entry_id?: string;
  contact_id?: string;
  external_id?: string;
  invoice_number: string;
  amount_cents: number;
  taxes_cents?: number;
  description?: string;
  customer?: {
    external_id?: string;
    first_name?: string;
    last_name?: string;
    email?: string;
    mobile_phone?: string;
  };
  send_customer_to_centz?: boolean;
  customer_memo?: string;
  internal_memo?: string;
  invoice_date?: string;
  due_date?: string;
  expire_at?: string;
  purchase_order_number?: string;
  lines?: CentzLineInput[];
  options?: Record<string, unknown>;
}

export interface CreateCentzInvoiceLinkResult {
  invoice_id: string | null;
  external_id: string;
  invoice_number: string;
  payment_link: string | null;
  centz_invoice_id: string | null;
  status: string;
  raw_response: unknown;
}

export async function createCentzInvoiceLink(input: CreateCentzInvoiceLinkInput) {
  return edgeApi<CreateCentzInvoiceLinkResult>(
    "payment-api",
    "/centz/invoice/create-link",
    input as unknown as Record<string, unknown>,
  );
}

// Phase 2 — wired but server returns 501 until implemented
export async function sendCentzInvoice(externalId: string) {
  return edgeApi("payment-api", "/centz/send-invoice", { external_id: externalId });
}
export async function getCentzInvoice(externalId: string) {
  return edgeApi("payment-api", "/centz/get-invoice", { external_id: externalId });
}
