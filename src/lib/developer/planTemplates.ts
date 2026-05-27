// Plan templates used by the Cost Tracker Limits editor.
// Source of truth for "what does each plan tier offer."

export type PlanLimits = {
  plan_name: string;
  monthly_price: number;
  sms_monthly_limit: number;
  ai_prompt_monthly_limit: number;
  ai_token_monthly_limit: number;
  storage_mb_limit: number;
  map_load_monthly_limit: number;
  scrape_monthly_limit: number;
  roof_report_monthly_limit: number;
  voice_minute_monthly_limit: number;
  hard_stop_enabled: boolean;
  warning_threshold_percent: number;
};

export const PLAN_TEMPLATES: Record<string, PlanLimits> = {
  basic_50: {
    plan_name: "Basic $50",
    monthly_price: 50,
    sms_monthly_limit: 250,
    ai_prompt_monthly_limit: 100,
    ai_token_monthly_limit: 100_000,
    storage_mb_limit: 5_120,
    map_load_monthly_limit: 1_000,
    scrape_monthly_limit: 25,
    roof_report_monthly_limit: 0,
    voice_minute_monthly_limit: 0,
    hard_stop_enabled: true,
    warning_threshold_percent: 80,
  },
  starter_399: {
    plan_name: "Starter $399",
    monthly_price: 399,
    sms_monthly_limit: 2_000,
    ai_prompt_monthly_limit: 1_500,
    ai_token_monthly_limit: 1_000_000,
    storage_mb_limit: 25_000,
    map_load_monthly_limit: 5_000,
    scrape_monthly_limit: 100,
    roof_report_monthly_limit: 5,
    voice_minute_monthly_limit: 0,
    hard_stop_enabled: true,
    warning_threshold_percent: 80,
  },
  growth_799: {
    plan_name: "Growth $799",
    monthly_price: 799,
    sms_monthly_limit: 10_000,
    ai_prompt_monthly_limit: 10_000,
    ai_token_monthly_limit: 5_000_000,
    storage_mb_limit: 100_000,
    map_load_monthly_limit: 25_000,
    scrape_monthly_limit: 500,
    roof_report_monthly_limit: 20,
    voice_minute_monthly_limit: 300,
    hard_stop_enabled: true,
    warning_threshold_percent: 80,
  },
  enterprise: {
    plan_name: "Enterprise",
    monthly_price: 0,
    sms_monthly_limit: 50_000,
    ai_prompt_monthly_limit: 50_000,
    ai_token_monthly_limit: 25_000_000,
    storage_mb_limit: 500_000,
    map_load_monthly_limit: 100_000,
    scrape_monthly_limit: 2_500,
    roof_report_monthly_limit: 100,
    voice_minute_monthly_limit: 2_000,
    hard_stop_enabled: false,
    warning_threshold_percent: 80,
  },
};

export const PLAN_TEMPLATE_LIST = Object.entries(PLAN_TEMPLATES).map(([key, t]) => ({ key, ...t }));

// $10 infra cost ceiling per $50 customer (the viability rule).
export const PLAN_INFRA_TARGET_RATIO = 0.2;
export function targetInfraCost(monthlyPrice: number) {
  return monthlyPrice * PLAN_INFRA_TARGET_RATIO;
}
