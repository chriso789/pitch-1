// Cost Tracker API client. Single source of truth for platform-api calls.
import { edgeApi } from "@/lib/edgeApi";

export type StatusKind = "good" | "watch" | "bad" | "losing_money" | "over_cost" | "no_data";

export type Dashboard = {
  month: string;
  revenue_mtd: number;
  cost_mtd: number;
  gross_profit: number;
  gross_margin_percent: number;
  by_provider: Record<string, number>;
  most_expensive_company: { tenant_id?: string; name: string; cost: number } | null;
  most_expensive_user: { user_id: string; cost: number } | null;
};

export type CompanyRow = {
  tenant_id: string; name: string; plan_name: string;
  monthly_price: number; cost_mtd: number; gross_profit: number; gross_margin_percent: number;
  status: StatusKind;
  sms_used: number; sms_limit: number;
  ai_prompts_used: number; ai_prompts_limit: number;
  ai_tokens_used: number; ai_tokens_limit: number;
  storage_used: number; storage_limit: number;
  roof_reports_used: number; roof_reports_limit: number;
};

export type CompanyDetail = {
  tenant: { id: string; name?: string };
  limit: any;
  totals: { cost_mtd: number; revenue: number; projected_month_end: number; projected_margin_percent: number };
  by_provider: Record<string, number>;
  by_feature: Record<string, number>;
  by_user: Record<string, number>;
  by_day: Record<string, number>;
  events: any[];
};

export type ProviderCost = {
  id: string; provider: string; event_type: string; unit: string;
  cost_per_unit: number; markup_percent: number; is_active: boolean;
};

export type UserRow = {
  user_id: string; tenant_id: string | null;
  full_name: string | null; email: string | null; company_name: string | null;
  event_count: number; sms_count: number; ai_prompt_count: number; ai_token_count: number;
  voice_minutes: number; estimated_cost: number; breakdown: Record<string, number>;
};

export type FeatureRow = {
  feature_area: string; event_count: number; total_cost: number; total_quantity: number;
  event_types: string[]; top_tenant_id: string | null; top_tenant_cost: number;
  top_user_id: string | null; top_user_cost: number;
};

export type ProviderBreakdownRow = {
  provider: string; event_type: string;
  event_count: number; total_quantity: number; total_cost: number; total_billable: number;
};

export type UnassignedEvent = {
  id: string; created_at: string; provider: string; event_type: string;
  feature_area: string | null; user_id: string | null; edge_function: string | null;
  estimated_cost: number; metadata: Record<string, any>; tenant_id: string | null;
  status: string; suggested_resolution: string;
};

export type CoverageRow = { key: string; label: string; status: "green" | "yellow" | "red" };
export type RollupStatus = { last_recalc_at: string | null; stale: boolean; month: string };
export type ZeroCostRow = { provider: string; event_type: string; count: number };

const call = <T,>(path: string, body?: unknown) => edgeApi<T>("platform-api", path, body);

export const costTrackerApi = {
  getDashboard: () => call<Dashboard>("/dashboard"),
  getCompanies: () => call<{ rows: CompanyRow[]; month: string }>("/companies"),
  getCompanyDetail: (tenant_id: string) =>
    call<CompanyDetail>(`/company-detail?tenant_id=${encodeURIComponent(tenant_id)}`),
  getUsers: (limit = 100) => call<{ rows: UserRow[]; month: string }>(`/users?limit=${limit}`),
  getUserDetail: (user_id: string) =>
    call(`/user-detail?user_id=${encodeURIComponent(user_id)}`),
  getProviderCosts: () => call<{ rows: ProviderCost[] }>("/provider-costs"),
  updateProviderCost: (payload: Partial<ProviderCost> & { id: string }) =>
    call<ProviderCost>("/provider-costs/update", payload),
  getCoverageChecklist: () => call<{ rows: CoverageRow[]; window: string }>("/coverage-checklist"),
  getUnassignedEvents: (includeTest = false, limit = 200) =>
    call<{ rows: UnassignedEvent[]; count: number }>(
      `/unassigned-events?include_test=${includeTest}&limit=${limit}`,
    ),
  assignUsageEventCompany: (usage_event_id: string, tenant_id: string, reason?: string) =>
    call("/usage-events/assign-company", { usage_event_id, tenant_id, reason }),
  getFeatureBreakdown: () => call<{ rows: FeatureRow[] }>("/feature-breakdown"),
  getProviderBreakdown: () => call<{ rows: ProviderBreakdownRow[] }>("/provider-breakdown"),
  updateCompanyUsageLimits: (payload: Record<string, unknown> & { tenant_id: string }) =>
    call("/company-usage-limits/update", payload),
  seedTestEvent: (
    event_type: string,
    provider: string,
    quantity = 1,
    extra: Record<string, unknown> = {},
  ) => call("/seed-test-event", { event_type, provider, quantity, ...extra }),
  recalculateRollups: () => call("/recalculate-rollups", {}),
  getInternalSecretStatus: () => call<{ configured: boolean }>("/internal-secret-status"),
  getRollupStatus: () => call<RollupStatus>("/rollup-status"),
  getZeroCostEvents: () => call<{ rows: ZeroCostRow[] }>("/zero-cost-events"),
};
