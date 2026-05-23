// AccuLynx adapter
import type { ImportFileDescriptor, NormalizeInput, NormalizeOutput, PitchImportEntity, VendorImportAdapter } from "./types.ts";
import { buildManifestFromFiles, emptyDetection, ext, fileMatchesAny, headersInclude, planFromManifest, stubNormalize, suggestFromDictionary } from "./_helpers.ts";
import { normalizeEmail, normalizePhone, parseDate, titleCase, trim } from "../transforms.ts";

const DICT: Record<PitchImportEntity, Record<string, string>> = {
  contact: {
    lead_id: "source_record_id", customer: "full_name",
    email: "email", phone: "phone", address: "address_line1", city: "city", state: "state", zip: "zip_code",
  } as any,
  job: {
    job_id: "source_record_id", customer: "customer_name", trade: "job_type",
    milestone: "stage", production_status: "status", date_created: "created_at",
  } as any,
  document: {} as any, image: {} as any, payment: {} as any, activity: {} as any,
  lead: {} as any, property: {} as any, project: {} as any, estimate: {} as any,
  invoice: {} as any, budget: {} as any, budget_line_item: {} as any, message: {} as any, call: {} as any, task: {} as any, note: {} as any,
};

const adapter: VendorImportAdapter = {
  sourceSystem: "acculynx",
  displayName: "AccuLynx",
  version: "1.0.0",
  supportedFileTypes: ["csv", "zip"],
  supportedEntityTypes: ["contact", "job", "document", "image", "payment", "activity"],

  async detect(files) {
    const det = emptyDetection();
    let hits = 0;
    const entities: Record<string, number> = {};
    for (const f of files) {
      if (fileMatchesAny(f.name, ["acculynx"])) hits += 3;
      if (fileMatchesAny(f.name, ["contact", "customer"])) { hits += 1; entities.contact = (entities.contact ?? 0) + 1; }
      if (fileMatchesAny(f.name, ["job"])) { hits += 1; entities.job = (entities.job ?? 0) + 1; }
      if (fileMatchesAny(f.name, ["payment"])) { hits += 1; entities.payment = (entities.payment ?? 0) + 1; }
      if (fileMatchesAny(f.folder ?? "", ["document", "photo"])) { hits += 1; entities.document = (entities.document ?? 0) + 1; }
      hits += headersInclude(f.headers, ["lead_id", "job_id", "milestone", "production_status", "trade"]);
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
        sourceRecordId: (r.lead_id ?? r.customer_id) as string | undefined,
        normalized: {
          full_name: titleCase(r.customer) ?? null,
          email: normalizeEmail(r.email),
          phone: normalizePhone(r.phone),
          address_line1: trim(r.address) ?? null,
          city: trim(r.city) ?? null,
          state: trim(r.state) ?? null,
          zip_code: trim(r.zip) ?? null,
          lead_source: "acculynx_import",
        },
        warnings: [], confidence: 0.8,
      };
    }
    if (input.entityType === "job") {
      return {
        entityType: "job",
        sourceRecordId: r.job_id as string | undefined,
        normalized: {
          job_type: trim(r.trade) ?? null,
          stage: trim(r.milestone) ?? null,
          status: trim(r.production_status) ?? null,
          created_at: parseDate(r.date_created),
          customer_name: titleCase(r.customer) ?? null,
        },
        warnings: [], confidence: 0.75,
      };
    }
    return stubNormalize(this, input);
  },

  async buildMigrationPlan(manifest) {
    return planFromManifest(manifest, {
      contact: ["full_name", "phone"],
      job: ["status"],
    });
  },
};

export default adapter;
