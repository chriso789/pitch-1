import { Address, Enrichment, Provider } from './types';
import { hashAddress } from './utils';

export type PipelineOptions = { staleDays?: number };

export class EnrichmentService {
  constructor(private providers: Provider[], private cache: Map<string, Enrichment> = new Map()) {}

  async enrich(addr: Address, opts: PipelineOptions = {}): Promise<Enrichment> {
    const { staleDays = 30 } = opts;
    const key = hashAddress(addr);
    const cached = this.cache.get(key);
    if (cached && !this.isStale(cached, staleDays)) return cached;

    const sources: string[] = [];
    let norm = addr;
    
    // Normalize
    for (const p of this.providers) {
      if (p.normalize) {
        try {
          norm = (await p.normalize(norm)).address;
          sources.push(p.name + ':normalize');
          break;
        } catch {}
      }
    }
    
    // Geocode
    let place_id: string | undefined;
    let lat: number | undefined;
    let lng: number | undefined;
    for (const p of this.providers) {
      if (p.geocode) {
        try {
          const g = await p.geocode(norm);
          place_id = g.place_id;
          lat = g.lat;
          lng = g.lng;
          sources.push(p.name + ':geocode');
          break;
        } catch {}
      }
    }
    
    // Property/Owner
    let apn: string | undefined;
    let wkt: string | undefined;
    let owner: string | undefined;
    for (const p of this.providers) {
      if (p.property) {
        try {
          const pr = await p.property(place_id ? { place_id } : norm);
          apn = pr.apn;
          wkt = pr.wkt;
          owner = pr.owner;
          sources.push(p.name + ':property');
          break;
        } catch {}
      }
    }
    
    // People (phones/emails)
    let phones: string[] = [];
    let emails: string[] = [];
    for (const p of this.providers) {
      if (p.people) {
        try {
          const pe = await p.people({ address: norm, name: owner });
          phones = pe.phones || [];
          emails = pe.emails || [];
          sources.push(p.name + ':people');
          break;
        } catch {}
      }
    }
    
    // Phone Verify
    let verified: { number: string; type?: string; score?: number }[] = [];
    if (phones.length) {
      for (const p of this.providers) {
        if (p.phoneVerify) {
          try {
            verified = await p.phoneVerify(phones);
            sources.push(p.name + ':phoneVerify');
            break;
          } catch {}
        }
      }
    }

    const out: Enrichment = {
      place_id,
      address_norm: norm,
      location: lat && lng ? { lat, lng } : undefined,
      parcel: { apn, wkt },
      owner: { name: owner },
      phones: verified.length ? verified : phones.map(n => ({ number: n })),
      emails: emails.map(e => ({ email: e })),
      sources,
    };
    
    this.cache.set(key, out);
    return out;
  }

  private isStale(_e: Enrichment, _days: number) {
    return false; /* wire created_at later */
  }

  async getHealthStatus(): Promise<{ name: string; ok: boolean; latency_ms?: number; quota?: string; error?: string }[]> {
    const results = await Promise.allSettled(
      this.providers.map(provider => provider.health())
    );

    return results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        return {
          name: this.providers[index].name,
          ok: false,
          error: result.reason instanceof Error ? result.reason.message : 'Unknown error'
        };
      }
    });
  }

  getProviders(): Provider[] {
    return [...this.providers];
  }

  getCacheStats(): { size?: number } {
    return {
      size: this.cache.size
    };
  }

  clearCache(): void {
    this.cache.clear();
  }
}
