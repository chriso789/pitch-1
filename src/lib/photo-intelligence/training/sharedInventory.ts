import { edgeApi } from '@/lib/edgeApi';

export interface SharedInventory {
  customer_photos: number; other_image_records: number; eligible_photos: number;
  contributing_companies: number; properties: number; all_customer_properties: number;
  companies_without_consent: number; unassigned_eligible_photos: number;
  processed_photos: number; candidate_regions: number;
  failures: { reason: string; photos: number }[];
  approved_by_component: { component: string; examples: number }[];
  recognition_result: null;
  photos: { id: string; tenantId: string; propertyKey: string; url: string | null; accessError?: string }[];
}
export async function loadSharedInventory(batch = false): Promise<SharedInventory> {
  const { data, error } = await edgeApi<SharedInventory>('training-data-api', batch ? '/photos/batch' : '/photos/inventory');
  if (error || !data) throw new Error(error ?? 'Inventory unavailable');
  return data;
}