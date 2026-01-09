-- Add manager override configuration columns to profiles table
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS manager_override_applies_to TEXT DEFAULT 'assigned_reps';
-- Values: 'all_reps', 'assigned_reps', 'location_reps', 'selected_reps'

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS manager_override_basis TEXT DEFAULT 'contract_value';
-- Values: 'contract_value', 'gross_profit', 'net_profit'

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS manager_override_min_profit_percent NUMERIC(5,2) DEFAULT 0;
-- Minimum profit % required for manager to receive override

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS manager_override_selected_reps UUID[] DEFAULT '{}';
-- Specific rep IDs when applies_to = 'selected_reps'

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS manager_override_location_id UUID REFERENCES locations(id);
-- Location ID when applies_to = 'location_reps'

-- Add index for faster lookups when filtering by location
CREATE INDEX IF NOT EXISTS idx_profiles_manager_override_location ON profiles(manager_override_location_id) WHERE manager_override_location_id IS NOT NULL;