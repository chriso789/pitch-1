// Generic ZIP fallback adapter — analyze folder structure + file extensions.
import type { NormalizeInput, NormalizeOutput, PitchImportEntity, VendorImportAdapter } from "./types.ts";
import { buildManifestFromFiles, emptyDetection, ext, planFromManifest } from "./_helpers.ts";

const IMG = new Set(["jpg", "jpeg", "png", "heic", "webp", "gif"]);
const DOC = new Set(["pdf", "doc", "docx", "xls", "xlsx", "txt", "rtf"]);

const adapter: VendorImportAdapter = {
  sourceSystem: "generic_zip",
  displayName: "Generic ZIP",
  version: "1.0.0",
  supportedFileTypes: ["zip"],
  supportedEntityTypes: ["document", "image"],

  async detect(files) {
    const det = emptyDetection();
    const entities: Record<string, number> = {};
    let total = 0;
    for (const f of files) {
      const e = (f.ext ?? ext(f.name)).toLowerCase();
      if (IMG.has(e)) { entities.image = (entities.image ?? 0) + 1; total += 1; }
      else if (DOC.has(e)) { entities.document = (entities.document ?? 0) + 1; total += 1; }
    }
    det.detectedEntities = entities;
    det.confidence = total > 0 ? 0.4 : 0;
    if (total > 0) det.warnings.push("Generic ZIP fallback: matching files to contacts/jobs by filename/folder only.");
    return det;
  },

  async buildManifest(files) { return buildManifestFromFiles(this.sourceSystem, files, await this.detect(files)); },

  async suggestFieldMap() { return {}; },

  async normalizeRecord(input: NormalizeInput): Promise<NormalizeOutput> {
    return {
      entityType: input.entityType,
      normalized: input.raw,
      warnings: ["Generic ZIP adapter: file metadata only. Manual linking required."],
      confidence: 0.4,
    };
  },

  async buildMigrationPlan(manifest) {
    return planFromManifest(manifest, {}, {}, [
      "Generic ZIP fallback — review file/folder mapping before linking to jobs.",
      "Unmatched files will be quarantined.",
    ]);
  },
};

export default adapter;
