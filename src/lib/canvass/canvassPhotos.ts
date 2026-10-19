/**
 * Shared canvass photo pipeline: storage upload + record persistence + reads.
 *
 * Every file lands in the private `canvass-photos` bucket under
 * `{tenant_id}/...` (enforced by safeStorageUpload and bucket RLS), and every
 * upload creates a row in `canvass_photos` so photos actually show up in the
 * app (property gallery + Photo Gallery page) instead of living only in an
 * activity log.
 */
import { supabase } from '@/integrations/supabase/client';
import { safeStorageUpload } from '@/lib/storage/safeUpload';

export type CanvassPhotoCategory =
  | 'roof_damage'
  | 'siding_damage'
  | 'before'
  | 'after'
  | 'condition'
  | 'other';

export interface CanvassPhotoRecord {
  id: string;
  storage_path: string;
  signed_url?: string;
  property_id: string | null;
  property_address: string | null;
  category: string;
  notes: string | null;
  latitude: number | null;
  longitude: number | null;
  uploaded_by: string | null;
  created_at: string;
}

export interface UploadCanvassPhotoArgs {
  blob: Blob;
  tenantId: string;
  userId: string;
  propertyId?: string | null;
  propertyAddress?: string | null;
  category: string;
  notes?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  fileName?: string;
  takenAt?: string;
}

/** Uploads to storage, writes the canvass_photos record, and logs activity. */
export async function uploadCanvassPhoto(args: UploadCanvassPhotoArgs): Promise<string> {
  const {
    blob, tenantId, userId, propertyId, propertyAddress,
    category, notes, latitude, longitude,
  } = args;

  const fileName = args.fileName ?? `${Date.now()}.jpg`;
  const path = `${tenantId}/${propertyId || 'general'}/${fileName}`;

  const { error: uploadError } = await safeStorageUpload({
    bucket: 'canvass-photos',
    path,
    file: blob,
    tenantId,
    contentType: blob.type || 'image/jpeg',
  });
  if (uploadError) throw uploadError;

  const { data: record, error: insertError } = await supabase
    .from('canvass_photos')
    .insert({
      tenant_id: tenantId,
      property_id: propertyId || null,
      property_address: propertyAddress || null,
      category,
      notes: notes || null,
      storage_path: path,
      file_size: blob.size,
      mime_type: blob.type || 'image/jpeg',
      latitude: latitude ?? null,
      longitude: longitude ?? null,
      uploaded_by: userId,
      taken_at: args.takenAt ?? new Date().toISOString(),
    })
    .select('id')
    .single();
  if (insertError) throw insertError;

  // Keep the activity log entry so canvass stats stay accurate.
  await supabase.from('canvass_activity_log').insert({
    tenant_id: tenantId,
    user_id: userId,
    activity_type: 'photo_uploaded',
    latitude: latitude ?? null,
    longitude: longitude ?? null,
    activity_data: {
      property_id: propertyId,
      category,
      photo_path: path,
    },
  } as any);

  return record.id;
}

/** Reads tenant-scoped canvass photos with short-lived signed URLs. */
export async function fetchCanvassPhotos(args: {
  tenantId: string;
  propertyId?: string | null;
  uploadedBy?: string | null;
  limit?: number;
}): Promise<CanvassPhotoRecord[]> {
  const { tenantId, propertyId, uploadedBy, limit = 500 } = args;

  let query = supabase
    .from('canvass_photos')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (propertyId) query = query.eq('property_id', propertyId);
  if (uploadedBy) query = query.eq('uploaded_by', uploadedBy);

  const { data, error } = await query;
  if (error) throw error;

  const rows = (data ?? []) as Array<Record<string, any>>;
  if (rows.length === 0) return [];

  // Sign URLs in one batch call — createSignedUrls keeps ordering.
  const paths = rows.map((r) => r.storage_path as string);
  const { data: signed } = await supabase.storage
    .from('canvass-photos')
    .createSignedUrls(paths, 60 * 60);

  const urlByPath = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));

  return rows.map((r) => ({
    id: r.id,
    storage_path: r.storage_path,
    signed_url: urlByPath.get(r.storage_path) ?? undefined,
    property_id: r.property_id,
    property_address: r.property_address,
    category: r.category,
    notes: r.notes,
    latitude: r.latitude,
    longitude: r.longitude,
    uploaded_by: r.uploaded_by,
    created_at: r.created_at,
  })) as CanvassPhotoRecord[];
}
