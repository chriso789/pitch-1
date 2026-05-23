// JobNimbus adapter
import type { ImportFileDescriptor, NormalizeInput, NormalizeOutput, PitchImportEntity, VendorImportAdapter } from "./types.ts";
import { buildManifestFromFiles, emptyDetection, ext, fileMatchesAny, headersInclude, planFromManifest, stubNormalize, suggestFromDictionary } from "./_helpers.ts";
import { normalizeEmail, normalizePhone, parseDate, splitFullName, titleCase, trim } from "../transforms.ts";

const DICT: Record<PitchImportEntity, Record<string, string>> = {
  contact: {
    jnid: "source_record_id", customer_id: "source_record_id",
    first_name: "first_name", last_name: "last_name", display_name: "full_name",
    email: "email", mobile_phone: "phone", home_phone: "phone_secondary",
    address_line1: "address_line1", address_line2: "address_line2", city: "city", state_text: "state", zip: "zip_code",
    sales_rep: "owner_name",
  } as Record<string, string>,
  job: {
    jnid: "source_record_id", job_number: "job_number", name: "title",
    status_name: "status", date_created: "created_at", sales_rep: "owner_name",
    address_line1: "address_line1", city: "city", state_text: "state", zip: "zip_code",
  } as Record<string, string>,
  note: { jnid: "source_record_id", note: "body", date_created: "created_at" } as Record<string, string>,
  activity: { jnid: "source_record_id", type: "kind", date_created: "created_at" } as Record<string, string>,
  estimate: { jnid: "source_record_id", number: "estimate_number", total: "total_amount" } as Record<string, string>,
  document: {} as Record<string, string>, image: {} as Record<string, string>,
  lead: {} as any, property: {} as any, project: {} as any, invoice: {} as any, payment: {} as any,
  budget: {} as any, budget_line_item: {} as any, message: {} as any, call: {} as any, task: {} as any,
};

const adapter: VendorImportAdapter = {
  sourceSystem: "jobnimbus",
  displayName: "JobNimbus",
  version: "1.0.0",
  supportedFileTypes: ["csv", "zip", "json"],
  supportedEntityTypes: ["contact", "job", "note", "document", "image", "estimate", "activity"],

  async detect(files) {
    const det = emptyDetection();
    let hits = 0;
    const entities: Record<string, number> = {};
    for (const f of files) {
      const e = f.ext ?? ext(f.name);
      if (fileMatchesAny(f.name, ["contact"])) { hits += 2; entities.contact = (entities.contact ?? 0) + (f.sample_rows?.length ?? 1); }
      if (fileMatchesAny(f.name, ["job", "work_order"])) { hits += 2; entities.job = (entities.job ?? 0) + (f.sample_rows?.length ?? 1); }
      if (fileMatchesAny(f.name, ["activit", "note"])) { hits += 1; entities.activity = (entities.activity ?? 0) + 1; }
      if (fileMatchesAny(f.name, ["estimate"])) { hits += 1; entities.estimate = (entities.estimate ?? 0) + 1; }
      if (fileMatchesAny(f.folder ?? "", ["document", "photo", "attachment"])) { hits += 1; entities.document = (entities.document ?? 0) + 1; }
      hits += headersInclude(f.headers, ["jnid", "customer_id", "job_number", "status_name", "date_created", "sales_rep"]);
      if (e === "json" && f.sample_rows?.some((r) => "jnid" in r)) hits += 3;
    }
    det.confidence = Math.min(1, hits / 8);
    det.detectedEntities = entities;
    if (det.confidence < 0.3) det.warnings.push("JobNimbus signals weak; consider generic_csv fallback.");
    return det;
  },

  async buildManifest(files) {
    const d = await this.detect(files);
    return buildManifestFromFiles(this.sourceSystem, files, d);
  },

  async suggestFieldMap(entity, fields) {
    return suggestFromDictionary(DICT, entity, fields);
  },

  async normalizeRecord(input: NormalizeInput): Promise<NormalizeOutput> {
    const r = input.raw;
    if (input.entityType === "contact") {
      const full = (r.display_name ?? r.name) as string | undefined;
      const split = full ? splitFullName(full) : { first_name: String(r.first_name ?? ""), last_name: String(r.last_name ?? "") };
      return {
        entityType: "contact",
        sourceRecordId: (r.jnid ?? r.customer_id) as string | undefined,
        normalized: {
          first_name: titleCase(split.first_name) ?? "",
          last_name:  titleCase(split.last_name)  ?? "",
          email: normalizeEmail(r.email),
          phone: normalizePhone(r.mobile_phone ?? r.phone),
          phone_secondary: normalizePhone(r.home_phone),
          address_line1: trim(r.address_line1) ?? null,
          address_line2: trim(r.address_line2) ?? null,
          city: trim(r.city) ?? null,
          state: trim(r.state_text ?? r.state) ?? null,
          zip_code: trim(r.zip) ?? null,
          lead_source: "jobnimbus_import",
        },
        warnings: [], confidence: 0.85,
      };
    }
    if (input.entityType === "job") {
      return {
        entityType: "job",
        sourceRecordId: (r.jnid ?? r.job_number) as string | undefined,
        normalized: {
          job_number: trim(r.job_number) ?? null,
          title: trim(r.name) ?? null,
          status: trim(r.status_name) ?? null,
          owner_name: trim(r.sales_rep) ?? null,
          created_at: parseDate(r.date_created),
          address_line1: trim(r.address_line1) ?? null,
          city: trim(r.city) ?? null,
          state: trim(r.state_text) ?? null,
          zip_code: trim(r.zip) ?? null,
        },
        warnings: [], confidence: 0.8,
      };
    }
    return stubNormalize(this, input);
  },

  async buildMigrationPlan(manifest) {
    return planFromManifest(manifest, {
      contact: ["first_name", "last_name", "phone"],
      job: ["job_number", "status"],
    }, {
      contact: ["email", "address_line1", "city", "state", "zip_code"],
      job: ["owner_name", "title"],
    });
  },
};

export default adapter;
