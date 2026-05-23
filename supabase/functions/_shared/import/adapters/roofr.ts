// Roofr adapter — measurement reports + proposals
import type { NormalizeInput, NormalizeOutput, PitchImportEntity, VendorImportAdapter } from "./types.ts";
import { buildManifestFromFiles, emptyDetection, ext, fileMatchesAny, headersInclude, planFromManifest, stubNormalize, suggestFromDictionary } from "./_helpers.ts";
import { parseCurrency, parseDate, trim } from "../transforms.ts";

const DICT: Record<PitchImportEntity, Record<string, string>> = {
  estimate: { proposal_number: "estimate_number", proposal_total: "total_amount", roof_area: "roof_area", waste_factor: "waste_factor" } as any,
  document: {} as any, image: {} as any,
  contact: {} as any, lead: {} as any, property: {} as any, job: {} as any, project: {} as any,
  invoice: {} as any, payment: {} as any, budget: {} as any, budget_line_item: {} as any,
  note: {} as any, activity: {} as any, message: {} as any, call: {} as any, task: {} as any,
};

const adapter: VendorImportAdapter = {
  sourceSystem: "roofr",
  displayName: "Roofr",
  version: "1.0.0",
  supportedFileTypes: ["csv", "pdf", "zip"],
  supportedEntityTypes: ["estimate", "document", "image"],

  async detect(files) {
    const det = emptyDetection();
    let hits = 0;
    const entities: Record<string, number> = {};
    for (const f of files) {
      const e = f.ext ?? ext(f.name);
      if (fileMatchesAny(f.name, ["roofr"])) hits += 3;
      if (e === "pdf" && fileMatchesAny(f.name, ["measurement", "report", "proposal"])) {
        hits += 2; entities.document = (entities.document ?? 0) + 1;
      }
      hits += headersInclude(f.headers, ["roof_area", "facets", "pitch", "waste_factor", "proposal_total"]);
    }
    det.confidence = Math.min(1, hits / 6);
    det.detectedEntities = entities;
    if (Object.keys(entities).length === 0) det.warnings.push("No clear Roofr signal; verify file naming.");
    return det;
  },

  async buildManifest(files) { return buildManifestFromFiles(this.sourceSystem, files, await this.detect(files)); },
  async suggestFieldMap(e, fields) { return suggestFromDictionary(DICT, e, fields); },

  async normalizeRecord(input: NormalizeInput): Promise<NormalizeOutput> {
    const r = input.raw;
    if (input.entityType === "estimate") {
      return {
        entityType: "estimate",
        sourceRecordId: (r.proposal_number ?? r.id) as string | undefined,
        normalized: {
          estimate_number: trim(r.proposal_number) ?? null,
          total_amount: parseCurrency(r.proposal_total ?? r.total),
          roof_area: Number(r.roof_area ?? 0) || null,
          waste_factor: Number(r.waste_factor ?? 0) || null,
          created_at: parseDate(r.created_at),
        },
        warnings: [], confidence: 0.7,
      };
    }
    return stubNormalize(this, input);
  },

  async buildMigrationPlan(manifest) {
    return planFromManifest(manifest, { estimate: ["estimate_number", "total_amount"] });
  },
};

export default adapter;
