// CompanyCam adapter — photo project exports
import type { NormalizeInput, NormalizeOutput, PitchImportEntity, VendorImportAdapter } from "./types.ts";
import { buildManifestFromFiles, emptyDetection, ext, fileMatchesAny, headersInclude, planFromManifest, stubNormalize, suggestFromDictionary } from "./_helpers.ts";
import { parseDate, trim } from "../transforms.ts";

const DICT: Record<PitchImportEntity, Record<string, string>> = {
  image: { photo_id: "source_record_id", project_id: "project_external_id", taken_at: "taken_at", creator: "uploaded_by_name" } as any,
  document: { project_id: "project_external_id" } as any,
  contact: {} as any, lead: {} as any, property: {} as any, job: {} as any, project: {} as any,
  estimate: {} as any, invoice: {} as any, payment: {} as any, budget: {} as any, budget_line_item: {} as any,
  note: {} as any, activity: {} as any, message: {} as any, call: {} as any, task: {} as any,
};

const IMAGE_EXT = new Set(["jpg", "jpeg", "png", "heic", "webp"]);

const adapter: VendorImportAdapter = {
  sourceSystem: "companycam",
  displayName: "CompanyCam",
  version: "1.0.0",
  supportedFileTypes: ["zip", "json"],
  supportedEntityTypes: ["image", "document"],

  async detect(files) {
    const det = emptyDetection();
    let hits = 0;
    const entities: Record<string, number> = {};
    for (const f of files) {
      const e = f.ext ?? ext(f.name);
      if (fileMatchesAny(f.name, ["companycam"])) hits += 3;
      if (fileMatchesAny(f.folder ?? "", ["projects", "project_"])) hits += 1;
      if (IMAGE_EXT.has(e)) { hits += 1; entities.image = (entities.image ?? 0) + 1; }
      hits += headersInclude(f.headers, ["project_id", "photo_id", "taken_at", "creator"]);
    }
    det.confidence = Math.min(1, hits / 8);
    det.detectedEntities = entities;
    if ((entities.image ?? 0) > 0 && hits < 4) det.warnings.push("Image-heavy ZIP without CompanyCam metadata; matching by folder/filename only.");
    return det;
  },

  async buildManifest(files) { return buildManifestFromFiles(this.sourceSystem, files, await this.detect(files)); },
  async suggestFieldMap(e, fields) { return suggestFromDictionary(DICT, e, fields); },

  async normalizeRecord(input: NormalizeInput): Promise<NormalizeOutput> {
    const r = input.raw;
    if (input.entityType === "image") {
      return {
        entityType: "image",
        sourceRecordId: (r.photo_id ?? r.id) as string | undefined,
        normalized: {
          project_external_id: trim(r.project_id) ?? null,
          taken_at: parseDate(r.taken_at),
          uploaded_by_name: trim(r.creator) ?? null,
          file_name: trim(r.file_name ?? r.name) ?? null,
        },
        warnings: [], confidence: 0.75,
      };
    }
    return stubNormalize(this, input);
  },

  async buildMigrationPlan(manifest) {
    return planFromManifest(manifest, { image: ["project_external_id"] }, {}, ["Images require linkable jobs/projects; import contacts/jobs first."]);
  },
};

export default adapter;
