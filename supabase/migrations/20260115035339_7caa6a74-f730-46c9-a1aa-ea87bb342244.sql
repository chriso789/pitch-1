-- Phase 11-30 Core Tables (Simplified)

-- Marketing Attribution
CREATE TABLE IF NOT EXISTS marketing_attributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
  pipeline_entry_id UUID REFERENCES pipeline_entries(id) ON DELETE SET NULL,
  lead_source TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  utm_content TEXT,
  referrer_url TEXT,
  landing_page TEXT,
  first_touch_at TIMESTAMPTZ,
  converted_at TIMESTAMPTZ,
  conversion_value DECIMAL(12,2),
  marketing_spend DECIMAL(10,2) DEFAULT 0,
  attribution_model TEXT DEFAULT 'last_touch',
  touchpoints JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Canvassing Achievement Definitions
CREATE TABLE IF NOT EXISTS canvass_achievement_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  badge_icon TEXT,
  badge_color TEXT DEFAULT '#FFD700',
  requirement_type TEXT NOT NULL,
  requirement_value INTEGER NOT NULL,
  reward_type TEXT,
  reward_value DECIMAL(10,2) DEFAULT 0,
  tier TEXT DEFAULT 'bronze',
  is_repeatable BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- User Achievement Progress
CREATE TABLE IF NOT EXISTS user_achievement_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  achievement_id UUID REFERENCES canvass_achievement_definitions(id) ON DELETE CASCADE,
  current_value INTEGER DEFAULT 0,
  target_value INTEGER NOT NULL,
  percentage_complete DECIMAL(5,2) DEFAULT 0,
  completed_at TIMESTAMPTZ,
  claimed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, achievement_id)
);

-- Weather Scheduling Rules
CREATE TABLE IF NOT EXISTS weather_scheduling_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  location_id UUID REFERENCES locations(id) ON DELETE CASCADE,
  rule_name TEXT NOT NULL,
  rain_probability_threshold INTEGER DEFAULT 60,
  wind_speed_threshold INTEGER DEFAULT 25,
  temp_min INTEGER DEFAULT 35,
  temp_max INTEGER DEFAULT 100,
  auto_reschedule BOOLEAN DEFAULT false,
  notify_crew BOOLEAN DEFAULT true,
  notify_customer BOOLEAN DEFAULT true,
  pause_production BOOLEAN DEFAULT true,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Inspection Checklists
CREATE TABLE IF NOT EXISTS inspection_checklists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  checklist_type TEXT NOT NULL,
  job_types TEXT[] DEFAULT ARRAY['roofing'],
  items JSONB NOT NULL DEFAULT '[]',
  required_photos INTEGER DEFAULT 0,
  requires_signature BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- AI Coaching Sessions
CREATE TABLE IF NOT EXISTS ai_coaching_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID REFERENCES profiles(id) ON DELETE CASCADE,
  session_type TEXT NOT NULL,
  call_log_id UUID REFERENCES call_logs(id) ON DELETE SET NULL,
  input_data JSONB,
  analysis JSONB,
  recommendations JSONB,
  score DECIMAL(5,2),
  strengths TEXT[],
  areas_for_improvement TEXT[],
  action_items JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Sales Best Practices
CREATE TABLE IF NOT EXISTS sales_best_practices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  script_template TEXT,
  keywords TEXT[],
  success_rate DECIMAL(5,2),
  usage_count INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Financial Forecasts
CREATE TABLE IF NOT EXISTS financial_forecasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  forecast_type TEXT NOT NULL,
  period_type TEXT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  forecast_data JSONB NOT NULL,
  actual_data JSONB,
  variance_percentage DECIMAL(8,2),
  confidence_score DECIMAL(5,2),
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- KPI Snapshots
CREATE TABLE IF NOT EXISTS kpi_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  location_id UUID REFERENCES locations(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,
  snapshot_type TEXT NOT NULL,
  metrics JSONB NOT NULL,
  comparisons JSONB,
  trends JSONB,
  alerts JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, location_id, snapshot_date, snapshot_type)
);

-- Enable RLS
ALTER TABLE marketing_attributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE canvass_achievement_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_achievement_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE weather_scheduling_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE inspection_checklists ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_coaching_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_best_practices ENABLE ROW LEVEL SECURITY;
ALTER TABLE financial_forecasts ENABLE ROW LEVEL SECURITY;
ALTER TABLE kpi_snapshots ENABLE ROW LEVEL SECURITY;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_marketing_attr_tenant ON marketing_attributions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_marketing_attr_contact ON marketing_attributions(contact_id);
CREATE INDEX IF NOT EXISTS idx_achievement_progress_user ON user_achievement_progress(user_id);
CREATE INDEX IF NOT EXISTS idx_weather_rules_location ON weather_scheduling_rules(location_id);
CREATE INDEX IF NOT EXISTS idx_ai_coaching_user ON ai_coaching_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_financial_forecasts_period ON financial_forecasts(tenant_id, period_start);