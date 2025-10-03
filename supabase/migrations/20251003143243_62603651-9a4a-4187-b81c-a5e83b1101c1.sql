-- Create enum types for competitions and achievements
CREATE TYPE achievement_type AS ENUM (
  'milestone',
  'skill',
  'streak',
  'special'
);

CREATE TYPE achievement_tier AS ENUM (
  'bronze',
  'silver',
  'gold',
  'platinum',
  'diamond'
);

CREATE TYPE competition_type AS ENUM (
  'daily',
  'weekly',
  'monthly',
  'custom'
);

CREATE TYPE competition_status AS ENUM (
  'draft',
  'active',
  'completed',
  'cancelled'
);

CREATE TYPE reward_status AS ENUM (
  'pending',
  'processing',
  'sent',
  'delivered',
  'claimed',
  'failed'
);

CREATE TYPE reward_type AS ENUM (
  'cash',
  'gift_card',
  'physical',
  'points',
  'badge'
);

-- Table: canvass_achievements
CREATE TABLE public.canvass_achievements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  achievement_type achievement_type NOT NULL DEFAULT 'milestone',
  tier achievement_tier NOT NULL DEFAULT 'bronze',
  category TEXT NOT NULL, -- 'doors_knocked', 'leads_generated', 'conversion_rate', etc.
  criteria JSONB NOT NULL DEFAULT '{}', -- Threshold values and conditions
  reward_points INTEGER NOT NULL DEFAULT 0,
  reward_type reward_type,
  reward_value NUMERIC(10,2) DEFAULT 0,
  reward_metadata JSONB DEFAULT '{}',
  icon_url TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT canvass_achievements_tenant_name_unique UNIQUE (tenant_id, name)
);

-- Table: user_achievements
CREATE TABLE public.user_achievements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  user_id UUID NOT NULL,
  achievement_id UUID NOT NULL REFERENCES public.canvass_achievements(id) ON DELETE CASCADE,
  progress NUMERIC(5,2) DEFAULT 0, -- Percentage (0-100)
  progress_data JSONB DEFAULT '{}', -- Detailed progress tracking
  unlocked_at TIMESTAMPTZ,
  reward_status reward_status DEFAULT 'pending',
  reward_sent_at TIMESTAMPTZ,
  reward_claimed_at TIMESTAMPTZ,
  reward_tracking JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT user_achievements_unique UNIQUE (tenant_id, user_id, achievement_id)
);

-- Table: canvass_competitions
CREATE TABLE public.canvass_competitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  competition_type competition_type NOT NULL DEFAULT 'weekly',
  status competition_status NOT NULL DEFAULT 'draft',
  start_date TIMESTAMPTZ NOT NULL,
  end_date TIMESTAMPTZ NOT NULL,
  rules JSONB NOT NULL DEFAULT '{}',
  scoring_criteria JSONB NOT NULL DEFAULT '{}', -- How points are calculated
  prize_pool JSONB NOT NULL DEFAULT '{}', -- Prize definitions for ranks
  auto_enroll BOOLEAN NOT NULL DEFAULT false,
  team_based BOOLEAN NOT NULL DEFAULT false,
  location_filter UUID[], -- Limit to specific locations
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Table: competition_participants
CREATE TABLE public.competition_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  competition_id UUID NOT NULL REFERENCES public.canvass_competitions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  team_name TEXT,
  current_score NUMERIC(10,2) NOT NULL DEFAULT 0,
  current_rank INTEGER,
  metrics JSONB DEFAULT '{}', -- Detailed performance metrics
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_activity_at TIMESTAMPTZ,
  CONSTRAINT competition_participants_unique UNIQUE (tenant_id, competition_id, user_id)
);

-- Table: competition_leaderboards
CREATE TABLE public.competition_leaderboards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  competition_id UUID NOT NULL REFERENCES public.canvass_competitions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  rank INTEGER NOT NULL,
  score NUMERIC(10,2) NOT NULL,
  metrics JSONB DEFAULT '{}',
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  is_final BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT competition_leaderboards_unique UNIQUE (tenant_id, competition_id, user_id, snapshot_at)
);

-- Table: achievement_rewards
CREATE TABLE public.achievement_rewards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  user_id UUID NOT NULL,
  achievement_id UUID REFERENCES public.canvass_achievements(id) ON DELETE SET NULL,
  competition_id UUID REFERENCES public.canvass_competitions(id) ON DELETE SET NULL,
  reward_type reward_type NOT NULL,
  reward_value NUMERIC(10,2) NOT NULL DEFAULT 0,
  reward_metadata JSONB DEFAULT '{}',
  status reward_status NOT NULL DEFAULT 'pending',
  stripe_payment_intent_id TEXT,
  tracking_number TEXT,
  recipient_email TEXT,
  recipient_address JSONB,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  sent_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  claimed_at TIMESTAMPTZ
);

-- Table: canvass_activity_log
CREATE TABLE public.canvass_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  user_id UUID NOT NULL,
  activity_type TEXT NOT NULL, -- 'door_knock', 'lead_created', 'photo_uploaded', etc.
  activity_data JSONB NOT NULL DEFAULT '{}',
  contact_id UUID,
  location_id UUID,
  latitude NUMERIC,
  longitude NUMERIC,
  quality_score NUMERIC(3,2), -- 0-1 quality rating
  verified BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for performance
CREATE INDEX idx_canvass_achievements_tenant ON public.canvass_achievements(tenant_id) WHERE is_active = true;
CREATE INDEX idx_canvass_achievements_type ON public.canvass_achievements(achievement_type, category);

CREATE INDEX idx_user_achievements_user ON public.user_achievements(tenant_id, user_id);
CREATE INDEX idx_user_achievements_unlocked ON public.user_achievements(tenant_id, unlocked_at) WHERE unlocked_at IS NOT NULL;
CREATE INDEX idx_user_achievements_reward_pending ON public.user_achievements(tenant_id, reward_status) WHERE reward_status = 'pending';

CREATE INDEX idx_competitions_tenant_status ON public.canvass_competitions(tenant_id, status);
CREATE INDEX idx_competitions_dates ON public.canvass_competitions(start_date, end_date) WHERE status = 'active';

CREATE INDEX idx_participants_competition ON public.competition_participants(competition_id, current_rank);
CREATE INDEX idx_participants_user ON public.competition_participants(tenant_id, user_id);

CREATE INDEX idx_leaderboards_competition ON public.competition_leaderboards(competition_id, rank) WHERE is_final = false;
CREATE INDEX idx_leaderboards_snapshot ON public.competition_leaderboards(snapshot_at DESC);

CREATE INDEX idx_rewards_user ON public.achievement_rewards(tenant_id, user_id);
CREATE INDEX idx_rewards_status ON public.achievement_rewards(tenant_id, status);

CREATE INDEX idx_activity_user_date ON public.canvass_activity_log(tenant_id, user_id, created_at DESC);
CREATE INDEX idx_activity_type ON public.canvass_activity_log(activity_type, created_at DESC);
CREATE INDEX idx_activity_location ON public.canvass_activity_log(tenant_id, location_id, created_at DESC);

-- Enable RLS on all tables
ALTER TABLE public.canvass_achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canvass_competitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competition_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competition_leaderboards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.achievement_rewards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.canvass_activity_log ENABLE ROW LEVEL SECURITY;

-- RLS Policies: canvass_achievements
CREATE POLICY "Users can view achievements in their tenant"
  ON public.canvass_achievements FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can manage achievements in their tenant"
  ON public.canvass_achievements FOR ALL
  USING (tenant_id = get_user_tenant_id() AND has_any_role(ARRAY['admin'::app_role, 'manager'::app_role, 'master'::app_role]));

-- RLS Policies: user_achievements
CREATE POLICY "Users can view their own achievements"
  ON public.user_achievements FOR SELECT
  USING (tenant_id = get_user_tenant_id() AND (user_id = auth.uid() OR has_any_role(ARRAY['admin'::app_role, 'manager'::app_role, 'master'::app_role])));

CREATE POLICY "System can insert user achievements"
  ON public.user_achievements FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "System can update user achievements"
  ON public.user_achievements FOR UPDATE
  USING (tenant_id = get_user_tenant_id());

-- RLS Policies: canvass_competitions
CREATE POLICY "Users can view competitions in their tenant"
  ON public.canvass_competitions FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Admins can manage competitions in their tenant"
  ON public.canvass_competitions FOR ALL
  USING (tenant_id = get_user_tenant_id() AND has_any_role(ARRAY['admin'::app_role, 'manager'::app_role, 'master'::app_role]));

-- RLS Policies: competition_participants
CREATE POLICY "Users can view participants in their tenant"
  ON public.competition_participants FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can join competitions"
  ON public.competition_participants FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id() AND user_id = auth.uid());

CREATE POLICY "System can update participants"
  ON public.competition_participants FOR UPDATE
  USING (tenant_id = get_user_tenant_id());

-- RLS Policies: competition_leaderboards
CREATE POLICY "Users can view leaderboards in their tenant"
  ON public.competition_leaderboards FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "System can manage leaderboards"
  ON public.competition_leaderboards FOR ALL
  USING (tenant_id = get_user_tenant_id());

-- RLS Policies: achievement_rewards
CREATE POLICY "Users can view their own rewards"
  ON public.achievement_rewards FOR SELECT
  USING (tenant_id = get_user_tenant_id() AND (user_id = auth.uid() OR has_any_role(ARRAY['admin'::app_role, 'manager'::app_role, 'master'::app_role])));

CREATE POLICY "System can manage rewards"
  ON public.achievement_rewards FOR ALL
  USING (tenant_id = get_user_tenant_id());

-- RLS Policies: canvass_activity_log
CREATE POLICY "Users can view activity in their tenant"
  ON public.canvass_activity_log FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can insert their own activity"
  ON public.canvass_activity_log FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id() AND user_id = auth.uid());

CREATE POLICY "System can update activity"
  ON public.canvass_activity_log FOR UPDATE
  USING (tenant_id = get_user_tenant_id());

-- Trigger to update updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_canvass_achievements_updated_at BEFORE UPDATE ON public.canvass_achievements
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_achievements_updated_at BEFORE UPDATE ON public.user_achievements
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_canvass_competitions_updated_at BEFORE UPDATE ON public.canvass_competitions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_competition_participants_updated_at BEFORE UPDATE ON public.competition_participants
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();