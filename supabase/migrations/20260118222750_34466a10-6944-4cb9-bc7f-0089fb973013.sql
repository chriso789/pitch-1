-- Add distance tracking columns to canvassiq_visits
ALTER TABLE canvassiq_visits 
ADD COLUMN IF NOT EXISTS distance_meters double precision,
ADD COLUMN IF NOT EXISTS property_lat double precision,
ADD COLUMN IF NOT EXISTS property_lng double precision,
ADD COLUMN IF NOT EXISTS gps_accuracy double precision,
ADD COLUMN IF NOT EXISTS is_verified boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS verification_status text DEFAULT 'pending';

-- Create GPS trail table for continuous location tracking during canvassing
CREATE TABLE IF NOT EXISTS canvass_gps_trail (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  session_id uuid,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  accuracy_meters double precision,
  speed_mps double precision,
  heading double precision,
  altitude double precision,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_canvass_gps_trail_user_session 
ON canvass_gps_trail(user_id, session_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_canvass_gps_trail_tenant_date 
ON canvass_gps_trail(tenant_id, recorded_at DESC);

-- Add index for distance verification queries
CREATE INDEX IF NOT EXISTS idx_canvassiq_visits_verification 
ON canvassiq_visits(user_id, is_verified, created_at DESC);

-- Enable RLS
ALTER TABLE canvass_gps_trail ENABLE ROW LEVEL SECURITY;

-- RLS policies for canvass_gps_trail
CREATE POLICY "Users can insert their own GPS trail"
ON canvass_gps_trail FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view their own GPS trail"
ON canvass_gps_trail FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Managers can view team GPS trails"
ON canvass_gps_trail FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
    AND p.tenant_id = canvass_gps_trail.tenant_id
    AND p.role::text IN ('super_admin', 'company_admin', 'sales_manager', 'owner')
  )
);

-- Add comment for documentation
COMMENT ON TABLE canvass_gps_trail IS 'Continuous GPS location tracking for canvassing sessions to verify rep activity';
COMMENT ON COLUMN canvassiq_visits.distance_meters IS 'Distance in meters from rep to property when disposition was set';
COMMENT ON COLUMN canvassiq_visits.is_verified IS 'Whether the visit was verified (rep was within acceptable distance)';