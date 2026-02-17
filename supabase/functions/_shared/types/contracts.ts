// supabase/functions/_shared/types/contracts.ts
// Shared contracts between edge functions and UI

export type PhoneCandidate = {
  number_e164: string;
  type: "mobile" | "landline" | "unknown";
  raw?: unknown;
  dnc?: boolean | null;
  wireless?: boolean | null;
  callable?: boolean;
  reason_blocked?: string | null;
};

export type EmailCandidate = {
  address: string;
  type?: "personal" | "work" | "unknown";
};

export type ScoreBlock = {
  score: number;
  reasons: string[];
};

export type PropertyEnrichDetailsRequest = {
  tenant_id: string;
  address?: string;
  lat?: number;
  lng?: number;
  property_id?: string;
  include_contact?: boolean;
  force_refresh?: boolean;
};

export type PropertyEnrichDetailsResponse = {
  success: boolean;
  normalized_address_key: string;
  geo: {
    state?: string;
    county?: string;
    state_fips?: string;
    county_fips?: string;
  };
  public: Record<string, unknown> | null;
  contact: {
    phones: PhoneCandidate[];
    emails: EmailCandidate[];
    age: number | null;
    relatives: string[];
    cached: boolean;
  } | null;
  scores: {
    equity: ScoreBlock;
    absentee: ScoreBlock;
    roof_age: ScoreBlock;
    cached: boolean;
  };
  cached: {
    public: boolean;
    contact: boolean;
  };
};

export type DNCScrubRequest = {
  tenant_id: string;
  phones_e164: string[];
};

export type DNCScrubResponse = {
  success: boolean;
  results: Record<string, { is_dnc: boolean | null; is_wireless: boolean | null; source?: string }>;
};

export type DoorKnockStrategyRequest = {
  tenant_id: string;
  user_id?: string;
  property_id?: string;
  normalized_address_key: string;
  public: Record<string, unknown>;
  contact?: Record<string, unknown>;
  scores: {
    equity: ScoreBlock;
    absentee: ScoreBlock;
    roof_age: ScoreBlock;
  };
  context?: {
    time_local?: string;
    mode?: "insurance" | "retail" | "maintenance";
    goal?: "inspection" | "appointment" | "leave_behind";
  };
};

export type DoorKnockStrategyResponse = {
  success: boolean;
  strategy: {
    angle: "insurance" | "retail" | "maintenance";
    opener: string;
    credibility: string;
    discovery_questions: string[];
    likely_objections: Array<{ objection: string; response: string }>;
    next_best_action: string;
    leave_behind: string;
    compliance_notes: string[];
  };
};
