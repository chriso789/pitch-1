// Jobber adapter
import type { NormalizeInput, NormalizeOutput, PitchImportEntity, VendorImportAdapter } from "./types.ts";
import { buildManifestFromFiles, emptyDetection, fileMatchesAny, headersInclude, planFromManifest, stubNormalize, suggestFromDictionary } from "./_helpers.ts";
import { normalizeEmail, normalizePhone, parseCurrency, parseDate, titleCase, trim } from "../transforms.ts";

const DICT: Record<PitchImportEntity, Record<string, string>> = {
  contact: { client_name: "full_name", email: "email", phone: "phone" } as any,
  property: { address: "address_line1", city: "city", state: "state", zip: "zip_code" } as any,
  job: { job_number: "job_number", visit_schedule: "scheduled_at", status: "status" } as any,
  estimate: { quote_number: "estimate_number", quote_status: "status", total: "total_amount" } as any,
  invoice: { invoice_number: "invoice_number", total: "total_amount" } as any,
  lead: {} as any, project: {} as any, payment: {} as any, budget: {} as any, budget_line_item: {} as any,
  note: {} as any, activity: {} as any, document: {} as any, image: {} as any, message: {} as any, call: {} as any, task: {} as any,
};

const adapter: VendorImportAdapter = {
  sourceSystem: "jobber",
  displayName: "Jobber",
  version: "1.0.0",
  supportedFileTypes: ["csv", "zip"],
  supportedEntityTypes: ["contact", "property", "job", "estimate", "invoice"],

  async detect(files) {
    const det = emptyDetection();
    let hits = 0;
    const entities: Record<string, number> = {};
    for (const f of files) {
      if (fileMatchesAny(f.name, ["jobber"])) hits += 3;
      if (fileMatchesAny(f.name, ["client"])) { hits += 1; entities.contact = (entities.contact ?? 0) + 1; }
      if (fileMatchesAny(f.name, ["propert"])) { hits += 1; entities.property = (entities.property ?? 0) + 1; }
      if (fileMatchesAny(f.name, ["quote"])) { hits += 1; entities.estimate = (entities.estimate ?? 0) + 1; }
      if (fileMatchesAny(f.name, ["invoice"])) { hits += 1; entities.invoice = (entities.invoice ?? 0) + 1; }
      if (fileMatchesAny(f.name, ["job", "request"])) { hits += 1; entities.job = (entities.job ?? 0) + 1; }
      hits += headersInclude(f.headers, ["client_name", "job_number", "visit_schedule", "quote_status"]);
    }
    det.confidence = Math.min(1, hits / 7);
    det.detectedEntities = entities;
    return det;
  },

  async buildManifest(files) { return buildManifestFromFiles(this.sourceSystem, files, await this.detect(files)); },
  async suggestFieldMap(e, fields) { return suggestFromDictionary(DICT, e, fields); },

  async normalizeRecord(input: NormalizeInput): Promise<NormalizeOutput> {
    const r = input.raw;
    if (input.entityType === "contact") {
      return {
        entityType: "contact",
        sourceRecordId: (r.client_id ?? r.client_name) as string | undefined,
        normalized: {
          full_name: titleCase(r.client_name) ?? null,
          email: normalizeEmail(r.email),
          phone: normalizePhone(r.phone),
          lead_source: "jobber_import",
        },
        warnings: [], confidence: 0.8,
      };
    }
    if (input.entityType === "job") {
      return {
        entityType: "job",
        sourceRecordId: (r.job_id ?? r.job_number) as string | undefined,
        normalized: {
          job_number: trim(r.job_number) ?? null,
          scheduled_at: parseDate(r.visit_schedule),
          status: trim(r.status) ?? null,
        },
        warnings: [], confidence: 0.75,
      };
    }
    if (input.entityType === "invoice") {
      return {
        entityType: "invoice",
        sourceRecordId: r.invoice_number as string | undefined,
        normalized: { invoice_number: trim(r.invoice_number) ?? null, total_amount: parseCurrency(r.total) },
        warnings: [], confidence: 0.75,
      };
    }
    return stubNormalize(this, input);
  },

  async buildMigrationPlan(manifest) {
    return planFromManifest(manifest, { contact: ["full_name"], job: ["job_number"] });
  },
};

export default adapter;
