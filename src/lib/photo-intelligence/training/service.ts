import { supabase } from '@/integrations/supabase/client';
import type { Database, Json } from '@/integrations/supabase/types';
import { safeStorageUpload } from '@/lib/storage/safeUpload';
import { zipSync, strToU8 } from 'fflate';
import { toCoco, type DatasetVersion } from './dataset';
import { isTrainableClass } from './taxonomy';
import { registerCanvassTrainingPhoto } from '@/lib/canvass/canvassPhotos';

export type Original = Database['public']['Tables']['photo_training_originals']['Row'] & { url: string };
export type Label = Database['public']['Tables']['photo_training_labels']['Row'];
export type Model = Database['public']['Tables']['photo_damage_models']['Row'];
export type SavedDataset = Database['public']['Tables']['photo_training_datasets']['Row'];
export type TrainingEvent = Database['public']['Tables']['photo_training_events']['Row'];

export async function loadTraining(t: string) {
  // Recover uploads whose image/record succeeded but candidate registration did not.
  // RLS plus the registration service validate company/property; no label is created.
  const { data: captures, error: captureError } = await supabase.from('canvass_photos').select('id,property_id').eq('tenant_id', t).not('property_id', 'is', null).order('created_at', { ascending: false }).limit(1000);
  const { data: registered, error: registeredError } = await supabase.from('photo_training_originals').select('source_photo_id').eq('tenant_id', t).eq('source_kind', 'live_canvass').limit(1000);
  const registrationWarnings: string[] = [];
  if (captureError || registeredError) registrationWarnings.push('Could not check canvassing review intake');
  const ids = new Set((registered ?? []).map((o) => o.source_photo_id));
  for (const capture of (captures ?? []).filter((p) => !ids.has(p.id))) {
    try { await registerCanvassTrainingPhoto(capture.id); }
    catch { registrationWarnings.push(capture.id); }
  }
  const [originals, labels, datasets, models, events, deployments] = await Promise.all([
    supabase.from('photo_training_originals').select('*').eq('tenant_id', t).order('created_at', { ascending: false }).limit(1000),
    supabase.from('photo_training_labels').select('*').eq('tenant_id', t).limit(1000),
    supabase.from('photo_training_datasets').select('*').eq('tenant_id', t).order('created_at', { ascending: false }).limit(100),
    supabase.from('photo_damage_models').select('*').eq('tenant_id', t).order('created_at', { ascending: false }).limit(100),
    supabase.from('photo_training_events').select('*').eq('tenant_id', t).order('created_at', { ascending: false }).limit(200),
    supabase.from('photo_damage_deployments').select('*').eq('tenant_id', t).order('created_at', { ascending: false }).limit(100),
  ]);
  for (const result of [originals, labels, datasets, models, events, deployments]) if (result.error) throw new Error('Could not load company training records');
  const photos: Original[] = [];
  for (const original of originals.data ?? []) {
    if (!['photo-training-originals', 'canvass-photos'].includes(original.storage_bucket) || !original.storage_path.startsWith(`${t}/`)) throw new Error('Original photo provenance is invalid');
    const { data, error } = await supabase.storage.from(original.storage_bucket).createSignedUrl(original.storage_path, 900);
    if (error) throw new Error('Could not open a private original photo');
    photos.push({ ...original, url: data.signedUrl });
  }
  return { originals: photos, labels: labels.data ?? [], datasets: datasets.data ?? [], models: models.data ?? [], events: events.data ?? [], deployments: deployments.data ?? [], registrationWarnings };
}

export async function uploadOriginal(t: string, property: string, file: File) {
  if (!property.trim()) throw new Error('A property identifier is required');
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 25 * 1024 * 1024) throw new Error('Choose JPEG, PNG or WebP originals up to 25 MB');
  const bytes = await file.arrayBuffer();
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map((b) => b.toString(16).padStart(2, '0')).join('');
  const { data: existing, error } = await supabase.from('photo_training_originals').select('id,property_id').eq('tenant_id', t).eq('sha256', hash).maybeSingle();
  if (error) throw new Error('Could not check for duplicate originals');
  if (existing) {
    if (existing.property_id !== property.trim()) throw new Error('This original already belongs to a different property');
    return existing.id;
  }
  const image = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const w = image.width, h = image.height; image.close();
  const extension = file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/png' ? 'png' : 'webp';
  const path = `${t}/originals/${hash}.${extension}`;
  const result = await safeStorageUpload({ bucket: 'photo-training-originals', tenantId: t, path, file, contentType: file.type, upsert: false });
  if (result.error && !/already exists|duplicate/i.test(result.error.message)) throw new Error('Original upload failed; please retry');
  const saved = await supabase.rpc('photo_training_original_add', { t, property: property.trim(), hash, path, name: `original.${extension}`, w, h });
  if (saved.error) throw new Error('Could not register the original photo; retry without uploading another copy');
  return saved.data;
}

export function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function exportDataset(ds: SavedDataset) {
  const saved = ds.manifest as unknown as DatasetVersion;
  const manifest = { ...saved, classes: saved.classes.filter(isTrainableClass) };
  const files: Record<string, Uint8Array> = { 'manifest.json': strToU8(JSON.stringify(manifest, null, 2)) };
  for (const split of ['train', 'val', 'test'] as const) files[`${split}.json`] = strToU8(JSON.stringify(toCoco(manifest, split)));
  let total = 0;
  for (const p of manifest.photos) {
    if (!p.storagePath?.startsWith(`${ds.tenant_id}/`)) throw new Error('Original photo provenance is missing');
    const bucket = p.storageBucket ?? 'photo-training-originals';
    if (!['photo-training-originals', 'canvass-photos'].includes(bucket)) throw new Error('Unsupported original photo source');
    const { data, error } = await supabase.storage.from(bucket).download(p.storagePath);
    if (error) throw new Error('Could not download an original; export stopped');
    total += data.size;
    if (total > 200 * 1024 * 1024) throw new Error('Dataset exceeds the 200 MB browser export limit');
    const bytes = await data.arrayBuffer();
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map((v) => v.toString(16).padStart(2, '0')).join('');
    if (hash !== p.sha256) throw new Error('Original image integrity failed; export stopped');
    files[`images/${p.fileName}`] = new Uint8Array(bytes);
  }
  const zip = zipSync(files, { level: 0 });
  downloadBlob(new Blob([zip.buffer as ArrayBuffer], { type: 'application/zip' }), `pitch-dataset-${ds.version}.zip`);
}

export const jsonValue = (value: unknown): Json => JSON.parse(JSON.stringify(value)) as Json;