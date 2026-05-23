// QuickBooks adapter
import type { NormalizeInput, NormalizeOutput, PitchImportEntity, VendorImportAdapter } from "./types.ts";
import { buildManifestFromFiles, emptyDetection, fileMatchesAny, headersInclude, planFromManifest, stubNormalize, suggestFromDictionary } from "./_helpers.ts";
import { normalizeEmail, normalizePhone, parseCurrency, parseDate, titleCase, trim } from "../transforms.ts";

const DICT: Record<PitchImportEntity, Record<string, string>> = {
  contact: { Customer: "full_name", Email: "email", Phone: "phone" } as any,
  invoice: { DocNumber: "invoice_number", TxnDate: "issue_date", Customer: "customer_name", Amount: "total_amount", Memo: "notes" } as any,
  payment: { DocNumber: "payment_number", TxnDate: "paid_at", Customer: "customer_name", Amount: "amount" } as any,
  budget: { Account: "category", Amount: "amount" } as any,
  budget_line_item: { Item: "name", Qty: "quantity", Rate: "rate", Amount: "amount" } as any,
  document: {} as any, image: {} as any, lead: {} as any, property: {} as any, job: {} as any, project: {} as any,
  estimate: {} as any, note: {} as any, activity: {} as any, message: {} as any, call: {} as any, task: {} as any,
};

const adapter: VendorImportAdapter = {
  sourceSystem: "quickbooks",
  displayName: "QuickBooks",
  version: "1.0.0",
  supportedFileTypes: ["csv", "xlsx", "iif"],
  supportedEntityTypes: ["contact", "invoice", "payment", "budget", "budget_line_item"],

  async detect(files) {
    const det = emptyDetection();
    let hits = 0;
    const entities: Record<string, number> = {};
    for (const f of files) {
      if (fileMatchesAny(f.name, ["quickbooks", "qbo", "qb_"])) hits += 3;
      if (fileMatchesAny(f.name, ["invoice"])) { hits += 1; entities.invoice = (entities.invoice ?? 0) + 1; }
      if (fileMatchesAny(f.name, ["payment"])) { hits += 1; entities.payment = (entities.payment ?? 0) + 1; }
      if (fileMatchesAny(f.name, ["customer"])) { hits += 1; entities.contact = (entities.contact ?? 0) + 1; }
      hits += headersInclude(f.headers, ["TxnDate", "DocNumber", "Customer", "Memo", "Account", "Debit", "Credit", "Item", "Qty", "Rate", "Amount"]);
    }
    det.confidence = Math.min(1, hits / 7);
    det.detectedEntities = entities;
    return det;
  },

  async buildManifest(files) { return buildManifestFromFiles(this.sourceSystem, files, await this.detect(files)); },
  async suggestFieldMap(e, fields) { return suggestFromDictionary(DICT, e, fields); },

  async normalizeRecord(input: NormalizeInput): Promise<NormalizeOutput> {
    const r = input.raw;
    if (input.entityType === "invoice") {
      return {
        entityType: "invoice",
        sourceRecordId: (r.DocNumber ?? r.Id) as string | undefined,
        normalized: {
          invoice_number: trim(r.DocNumber) ?? null,
          issue_date: parseDate(r.TxnDate),
          customer_name: titleCase(r.Customer) ?? null,
          total_amount: parseCurrency(r.Amount ?? r.Balance),
          notes: trim(r.Memo) ?? null,
        },
        warnings: [], confidence: 0.85,
      };
    }
    if (input.entityType === "payment") {
      return {
        entityType: "payment",
        sourceRecordId: r.DocNumber as string | undefined,
        normalized: {
          payment_number: trim(r.DocNumber) ?? null,
          paid_at: parseDate(r.TxnDate),
          customer_name: titleCase(r.Customer) ?? null,
          amount: parseCurrency(r.Amount),
        },
        warnings: [], confidence: 0.85,
      };
    }
    if (input.entityType === "contact") {
      return {
        entityType: "contact",
        sourceRecordId: (r.Customer ?? r.Id) as string | undefined,
        normalized: {
          full_name: titleCase(r.Customer) ?? null,
          email: normalizeEmail(r.Email),
          phone: normalizePhone(r.Phone),
          lead_source: "quickbooks_import",
        },
        warnings: [], confidence: 0.7,
      };
    }
    return stubNormalize(this, input);
  },

  async buildMigrationPlan(manifest) {
    return planFromManifest(manifest, {
      invoice: ["invoice_number", "total_amount"],
      payment: ["amount", "paid_at"],
      contact: ["full_name"],
    });
  },
};

export default adapter;
