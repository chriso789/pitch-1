-- Add status tracking fields to demo_requests table
ALTER TABLE demo_requests 
ADD COLUMN IF NOT EXISTS status text DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'scheduled', 'converted', 'declined')),
ADD COLUMN IF NOT EXISTS notes text,
ADD COLUMN IF NOT EXISTS contacted_at timestamptz,
ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES profiles(id);

-- Create index for status filtering
CREATE INDEX IF NOT EXISTS idx_demo_requests_status ON demo_requests(status);
CREATE INDEX IF NOT EXISTS idx_demo_requests_created_at ON demo_requests(created_at DESC);

-- Add settings tab for demo requests (master only) - use DO block for upsert logic
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM settings_tabs WHERE tab_key = 'demo-requests') THEN
    INSERT INTO settings_tabs (tab_key, label, description, icon_name, order_index, is_active, required_role)
    VALUES ('demo-requests', 'Demo Requests', 'Manage incoming demo requests from the website', 'UserCheck', 25, true, ARRAY['master']);
  ELSE
    UPDATE settings_tabs SET 
      label = 'Demo Requests',
      description = 'Manage incoming demo requests from the website',
      icon_name = 'UserCheck',
      is_active = true,
      required_role = ARRAY['master']
    WHERE tab_key = 'demo-requests';
  END IF;
END $$;