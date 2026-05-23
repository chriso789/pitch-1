// Generic CSV fallback adapter — relies on existing fieldAliases.
import type { NormalizeInput, NormalizeOutput, PitchImportEntity, VendorImportAdapter } from "./types.ts";
import { buildManifestFromFiles, emptyDetection, ext, planFromManifest } from "./_helpers.ts";
import { suggestMapping, guessEntityType } from "../fieldAliases.ts";

const adapter: VendorImportAdapter = {
  sourceSystem: "generic_csv",
  displayName: "Generic CSV",
  version: "1.0.0",
  supportedFileTypes: ["csv", "xlsx"],
  supportedEntityTypes: ["contact", "job", "invoice", "payment", "note"],

  async detect(files) {
    const det = emptyDetection();
    const entities: Record<string, number> = {};
    let total = 0;
    for (const f of files) {
      const e = f.ext ?? ext(f.name);
      if (e === "csv" || e === "xlsx") {
        total += 1;
        const guess = f.headers ? guessEntityType(f.headers) : null;
        if (guess) entities[guess] = (entities[guess] ?? 0) + (f.sample_rows?.length ?? 1);
      }
    }
    det.detectedEntities = entities;
    // Low baseline — this is fallback only.
    det.confidence = total > 0 ? 0.35 : 0;
    if (total > 0) det.warnings.push("Generic CSV fallback in use. Manual entity selection recommended.");
    return det;
  },

  async buildManifest(files) { return buildManifestFromFiles(this.sourceSystem, files, await this.detect(files)); },
  async suggestFieldMap(entity, fields) { return suggestMapping(entity, fields); },

  async normalizeRecord(input: NormalizeInput): Promise<NormalizeOutput> {
    return {
      entityType: input.entityType,
      normalized: input.raw,
      warnings: ["Generic CSV adapter: raw passthrough. Configure field mapping for production."],
      confidence: 0.5,
    };
  },

  async buildMigrationPlan(manifest) {
    return planFromManifest(manifest, {}, {}, [
      "Generic CSV fallback — manually confirm entity type and field map per file.",
    ]);
  },
};

export default adapter;
