-- Add phone setup columns to locations table
ALTER TABLE locations 
ADD COLUMN IF NOT EXISTS telnyx_phone_number TEXT,
ADD COLUMN IF NOT EXISTS telnyx_messaging_profile_id TEXT,
ADD COLUMN IF NOT EXISTS telnyx_voice_app_id TEXT,
ADD COLUMN IF NOT EXISTS phone_porting_status TEXT DEFAULT 'needs_setup' CHECK (phone_porting_status IN ('needs_setup', 'pending_port', 'port_submitted', 'active', 'failed')),
ADD COLUMN IF NOT EXISTS phone_setup_metadata JSONB DEFAULT '{}';

-- Create phone_port_requests table to track porting progress
CREATE TABLE IF NOT EXISTS phone_port_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  phone_number TEXT NOT NULL,
  current_carrier TEXT,
  account_number TEXT,
  account_pin TEXT,
  account_name TEXT,
  billing_address JSONB,
  telnyx_port_order_id TEXT,
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'in_progress', 'completed', 'failed', 'cancelled')),
  status_details TEXT,
  estimated_completion DATE,
  submitted_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE phone_port_requests ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view their tenant's port requests"
  ON phone_port_requests FOR SELECT
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can create port requests for their tenant"
  ON phone_port_requests FOR INSERT
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can update their tenant's port requests"
  ON phone_port_requests FOR UPDATE
  USING (tenant_id = get_user_tenant_id());

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_phone_port_requests_tenant ON phone_port_requests(tenant_id);
CREATE INDEX IF NOT EXISTS idx_phone_port_requests_location ON phone_port_requests(location_id);
CREATE INDEX IF NOT EXISTS idx_locations_telnyx_phone ON locations(telnyx_phone_number) WHERE telnyx_phone_number IS NOT NULL;