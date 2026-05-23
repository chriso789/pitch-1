// Housecall Pro adapter
import type { NormalizeInput, NormalizeOutput, PitchImportEntity, VendorImportAdapter } from "./types.ts";
import { buildManifestFromFiles, emptyDetection, fileMatchesAny, headersInclude, planFromManifest, stubNormalize, suggestFromDictionary } from "./_helpers.ts";
import { normalizeEmail, normalizePhone, parseCurrency, parseDate, titleCase, trim } from "../transforms.ts";

const DICT: Record<PitchImportEntity, Record<string, string>> = {
  contact: { customer_name: "full_name", email: "email", phone: "phone" } as any,
  job: { job_type: "job_type", scheduled_start: "scheduled_at", employee: "owner_name" } as any,
  estimate: { estimate_total: "total_amount" } as any,
  invoice: { invoice_total: "total_amount", invoice_number: "invoice_number" } as any,
  lead: {} as any, property: {} as any, project: {} as any, payment: {} as any, budget: {} as any, budget_line_item: {} as any,
  note: {} as any, activity: {} as any, document: {} as any, image: {} as any, message: {} as any, call: {} as any, task: {} as any,
};

const adapter: VendorImportAdapter = {
  sourceSystem: "housecallpro",
  displayName: "Housecall Pro",
  version: "1.0.0",
  supportedFileTypes: ["csv", "zip"],
  supportedEntityTypes: ["contact", "job", "estimate", "invoice"],

  async detect(files) {
    const det = emptyDetection();
    let hits = 0;
    const entities: Record<string, number> = {};
    for (const f of files) {
      if (fileMatchesAny(f.name, ["housecall", "hcp"])) hits += 3;
      if (fileMatchesAny(f.name, ["customer"])) { hits += 1; entities.contact = (entities.contact ?? 0) + 1; }
      if (fileMatchesAny(f.name, ["job"])) { hits += 1; entities.job = (entities.job ?? 0) + 1; }
      if (fileMatchesAny(f.name, ["estimate"])) { hits += 1; entities.estimate = (entities.estimate ?? 0) + 1; }
      if (fileMatchesAny(f.name, ["invoice"])) { hits += 1; entities.invoice = (entities.invoice ?? 0) + 1; }
      hits += headersInclude(f.headers, ["customer_name", "job_type", "scheduled_start", "invoice_total", "employee"]);
    }
    det.confidence = Math.min(1, hits / 6);
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
        sourceRecordId: (r.customer_id ?? r.customer_name) as string | undefined,
        normalized: {
          full_name: titleCase(r.customer_name) ?? null,
          email: normalizeEmail(r.email),
          phone: normalizePhone(r.phone),
          lead_source: "housecallpro_import",
        },
        warnings: [], confidence: 0.8,
      };
    }
    if (input.entityType === "job") {
      return {
        entityType: "job",
        sourceRecordId: (r.job_id ?? r.job_number) as string | undefined,
        normalized: {
          job_type: trim(r.job_type) ?? null,
          scheduled_at: parseDate(r.scheduled_start),
          owner_name: trim(r.employee) ?? null,
        },
        warnings: [], confidence: 0.75,
      };
    }
    if (input.entityType === "invoice") {
      return {
        entityType: "invoice",
        sourceRecordId: r.invoice_number as string | undefined,
        normalized: { invoice_number: trim(r.invoice_number) ?? null, total_amount: parseCurrency(r.invoice_total) },
        warnings: [], confidence: 0.8,
      };
    }
    return stubNormalize(this, input);
  },

  async buildMigrationPlan(manifest) {
    return planFromManifest(manifest, { contact: ["full_name"], invoice: ["total_amount"] });
  },
};

export default adapter;
