// Vendor adapter registry. Add new adapters here.

import type { ImportFileDescriptor, VendorImportAdapter } from "./types.ts";
import jobnimbus from "./jobnimbus.ts";
import acculynx from "./acculynx.ts";
import roofr from "./roofr.ts";
import quickbooks from "./quickbooks.ts";
import companycam from "./companycam.ts";
import jobber from "./jobber.ts";
import housecallpro from "./housecallPro.ts";
import genericCsv from "./genericCsv.ts";
import genericZip from "./genericZip.ts";

const ADAPTERS: Record<string, VendorImportAdapter> = {
  jobnimbus, acculynx, roofr, quickbooks, companycam, jobber, housecallpro,
  generic_csv: genericCsv, generic_zip: genericZip,
};

export function listAdapters(): VendorImportAdapter[] {
  return Object.values(ADAPTERS);
}

export function getAdapter(sourceSystem: string): VendorImportAdapter | null {
  return ADAPTERS[sourceSystem] ?? null;
}

/** Score every adapter against the file set; return ranked candidates. */
export async function rankAdapters(files: ImportFileDescriptor[]) {
  const out: Array<{ source_system: string; display_name: string; confidence: number; entities: Record<string, number>; warnings: string[] }> = [];
  for (const a of listAdapters()) {
    const d = await a.detect(files);
    out.push({
      source_system: a.sourceSystem,
      display_name: a.displayName,
      confidence: d.confidence,
      entities: d.detectedEntities,
      warnings: d.warnings,
    });
  }
  out.sort((x, y) => y.confidence - x.confidence);
  return out;
}

/** Pick the highest-confidence non-fallback adapter, else best fallback. */
export async function detectBestAdapter(files: ImportFileDescriptor[]) {
  const ranked = await rankAdapters(files);
  const branded = ranked.filter((r) => !r.source_system.startsWith("generic_") && r.confidence > 0.3);
  return branded[0] ?? ranked[0] ?? null;
}
