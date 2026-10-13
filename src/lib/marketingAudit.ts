export const MARKETING_CHANNELS = ['facebook', 'instagram', 'google', 'yelp', 'other'] as const;
export type MarketingChannel = typeof MARKETING_CHANNELS[number];
export const CHANNEL_LABELS: Record<MarketingChannel, string> = { facebook: 'Facebook', instagram: 'Instagram', google: 'Google Ads', yelp: 'Yelp', other: 'Other' };

export function classifySource(source?: string | null): MarketingChannel | 'unknown' {
  const value = source?.trim().toLowerCase();
  if (!value || ['unknown', 'advertisement', 'online', 'social_media', 'website'].includes(value)) return 'unknown';
  if (['facebook', 'facebook ads', 'fb', 'meta'].includes(value)) return 'facebook';
  if (['instagram', 'instagram ads', 'ig'].includes(value)) return 'instagram';
  if (['google', 'google ads', 'google_ads', 'adwords'].includes(value)) return 'google';
  if (['yelp', 'yelp ads'].includes(value)) return 'yelp';
  return 'other';
}

export function parseCostCents(value: string): number {
  if (!/^\d+(\.\d{1,2})?$/.test(value.trim())) throw new Error('Enter a positive amount with up to two decimal places.');
  const [whole, fraction = ''] = value.trim().split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 100000000000) throw new Error('Amount is outside the supported range.');
  return cents;
}

export function totalCost(rows: { amount_cents: number; entry_type: string }[]) {
  return rows.reduce((sum, row) => sum + (row.entry_type === 'credit' ? -1 : 1) * row.amount_cents, 0);
}

export function costPerLead(cents: number, leads: number): number | null {
  return leads > 0 ? cents / 100 / leads : null;
}