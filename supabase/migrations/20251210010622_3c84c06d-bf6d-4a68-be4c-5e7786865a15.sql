-- Add suspension and platform operator fields to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS is_suspended boolean DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS suspended_at timestamptz;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS suspended_by uuid REFERENCES profiles(id);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS suspension_reason text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS can_manage_all_companies boolean DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS created_by_master uuid REFERENCES profiles(id);

-- Create platform operators tracking table
CREATE TABLE IF NOT EXISTS platform_operators (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES profiles(id) ON DELETE CASCADE NOT NULL UNIQUE,
  created_by_master uuid REFERENCES profiles(id) NOT NULL,
  granted_permissions jsonb DEFAULT '{"view_all_companies": true, "manage_features": true, "manage_users": false, "delete_companies": false}',
  is_active boolean DEFAULT true,
  deactivated_at timestamptz,
  deactivated_by uuid REFERENCES profiles(id),
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS - Only master can manage platform operators
ALTER TABLE platform_operators ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Only master can view platform operators"
ON platform_operators FOR SELECT
USING (
  EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'master')
);

CREATE POLICY "Only master can insert platform operators"
ON platform_operators FOR INSERT
WITH CHECK (
  EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'master')
);

CREATE POLICY "Only master can update platform operators"
ON platform_operators FOR UPDATE
USING (
  EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'master')
);

CREATE POLICY "Only master can delete platform operators"
ON platform_operators FOR DELETE
USING (
  EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'master')
);