import { z } from 'zod';

export const AddressSchema = z.object({
  line1: z.string().min(3),
  line2: z.string().optional(),
  city: z.string(),
  state: z.string().length(2),
  postal_code: z.string().min(5),
});
export type Address = z.infer<typeof AddressSchema>;

export const EnrichmentSchema = z.object({
  place_id: z.string().optional(),
  address_norm: AddressSchema.optional(),
  location: z.object({ lat: z.number(), lng: z.number() }).optional(),
  parcel: z.object({ apn: z.string().optional(), wkt: z.string().optional() }).optional(),
  owner: z.object({ name: z.string().optional() }).optional(),
  phones: z.array(z.object({ number: z.string(), type: z.string().optional(), score: z.number().optional() })).optional(),
  emails: z.array(z.object({ email: z.string().email(), score: z.number().optional() })).optional(),
  sources: z.array(z.string()),
});
export type Enrichment = z.infer<typeof EnrichmentSchema>;

export type Health = { name: string; ok: boolean; latency_ms?: number; quota?: string; error?: string };

export interface Provider {
  name: string;
  health(): Promise<Health>;
  normalize?(addr: Address): Promise<{ address: Address }>;
  geocode?(addr: Address): Promise<{ place_id: string; lat: number; lng: number }>;
  property?(addr: Address | { place_id: string }): Promise<{ apn?: string; wkt?: string; owner?: string }>;
  people?(input: { name?: string; address: Address }): Promise<{ phones?: string[]; emails?: string[] }>;
  phoneVerify?(numbers: string[]): Promise<{ number: string; type?: string; score?: number }[]>;
}

export type PipelineOptions = { staleDays?: number };

export interface EnrichmentCache {
  get(key: string): Promise<Enrichment | null>;
  set(key: string, enrichment: Enrichment): Promise<void>;
  isStale(enrichment: Enrichment, staleDays: number): boolean;
}
