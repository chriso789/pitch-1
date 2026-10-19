/**
 * Reference-library persistence (Phase 1 + Phase 5 learning loop).
 *
 * The library lives in `photo_reference_examples`: every row is an
 * independently approved, inspector-corrected crop with provenance
 * (source photo + region, labeler, distinct approver). Unverified model
 * predictions can never enter — the only insert path requires both a
 * labeler and a different approver, and the database enforces it too.
 *
 * Writes are restricted to platform admins by RLS: promoting a correction
 * into the shared library is a platform-level decision, not something a
 * single tenant's inspector can do alone.
 */

import { supabase } from '@/integrations/supabase/client';
import {
  emptyLibrary,
  type ReferenceClass,
  type ReferenceExample,
  type VersionedReferenceLibrary,
} from './referenceClassifier';

const EMBEDDING_MODEL_ID = 'dinov2-small';

/** Load the latest reference library for the current embedding model. Empty on any failure — callers treat that as "no library", never as an error worth inventing labels over. */
export async function loadReferenceLibrary(): Promise<VersionedReferenceLibrary> {
  try {
    const { data, error } = await (supabase.from as any)('photo_reference_examples')
      .select('id, cls, embedding, library_version, source_photo_id, source_region_id, approved_by')
      .eq('embedding_model_id', EMBEDDING_MODEL_ID)
      .order('library_version', { ascending: false })
      .limit(2000);
    if (error || !data?.length) return emptyLibrary(EMBEDDING_MODEL_ID);
    const examples: ReferenceExample[] = [];
    for (const row of data) {
      const raw = row.embedding;
      if (!Array.isArray(raw) || !raw.length) continue;
      examples.push({
        id: String(row.id),
        cls: row.cls as ReferenceClass,
        embedding: Float32Array.from(raw.map(Number)),
        libraryVersion: Number(row.library_version) || 1,
        sourcePhotoId: String(row.source_photo_id),
        sourceRegionId: String(row.source_region_id),
        approvedBy: String(row.approved_by),
      });
    }
    return {
      version: Math.max(...data.map((r: any) => Number(r.library_version) || 1)),
      embeddingModelId: EMBEDDING_MODEL_ID,
      examples,
    };
  } catch {
    return emptyLibrary(EMBEDDING_MODEL_ID);
  }
}

/**
 * Promote an inspector correction into the shared reference library.
 * Both the labeler and a DIFFERENT approver are required; the embedding
 * must come from the current model. The caller supplies the region crop's
 * embedding computed from the ORIGINAL photo (originals stay immutable).
 */
export async function promoteCorrectionToReference(input: {
  cls: ReferenceClass;
  embedding: Float32Array;
  sourcePhotoId: string;
  sourceRegionId: string;
  sourceFindingId?: string | null;
  labeledBy: string;
  approvedBy: string;
}): Promise<{ ok: boolean; error?: string }> {
  if (!input.labeledBy || !input.approvedBy || input.labeledBy === input.approvedBy) {
    return { ok: false, error: 'A reference example needs an independent approver who is not the labeler.' };
  }
  if (!input.embedding.length) return { ok: false, error: 'Missing region embedding.' };
  const { data: maxRow } = await (supabase.from as any)('photo_reference_examples')
    .select('library_version')
    .eq('embedding_model_id', EMBEDDING_MODEL_ID)
    .order('library_version', { ascending: false })
    .limit(1);
  const nextVersion = (Number(maxRow?.[0]?.library_version) || 0) + 1;
  const { error } = await (supabase.from as any)('photo_reference_examples').insert({
    cls: input.cls,
    embedding: Array.from(input.embedding),
    embedding_model_id: EMBEDDING_MODEL_ID,
    library_version: nextVersion,
    source_photo_id: input.sourcePhotoId,
    source_region_id: input.sourceRegionId,
    source_finding_id: input.sourceFindingId ?? null,
    labeled_by: input.labeledBy,
    approved_by: input.approvedBy,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
