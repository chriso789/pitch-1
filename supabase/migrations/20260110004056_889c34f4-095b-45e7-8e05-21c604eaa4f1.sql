-- HOMEOWNER PORTAL: Core Tables Only (Part 1)
-- Tables, indexes, and RLS - RPCs will be added separately

-- 1. Portal Users
CREATE TABLE IF NOT EXISTS public.homeowner_portal_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  auth_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  phone TEXT,
  first_name TEXT,
  last_name TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(company_id, email)
);

-- 2. Job Access
CREATE TABLE IF NOT EXISTS public.homeowner_job_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  portal_user_id UUID NOT NULL REFERENCES homeowner_portal_users(id) ON DELETE CASCADE,
  access_level TEXT NOT NULL DEFAULT 'standard',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(company_id, job_id, portal_user_id)
);

-- 3. Job Public State
CREATE TABLE IF NOT EXISTS public.homeowner_job_public_state (
  company_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  public_status TEXT NOT NULL DEFAULT 'awaiting_schedule',
  public_stage TEXT NOT NULL DEFAULT 'intake',
  scheduled_dates JSONB DEFAULT '{}',
  public_notes TEXT,
  last_updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (company_id, job_id)
);

-- 4. Timeline Events
CREATE TABLE IF NOT EXISTS public.homeowner_timeline_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT,
  created_by_type TEXT NOT NULL DEFAULT 'system',
  is_visible BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 5. Shared Files
CREATE TABLE IF NOT EXISTS public.homeowner_shared_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  uploaded_by_staff_user_id UUID,
  file_type TEXT NOT NULL DEFAULT 'photo',
  storage_bucket TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  caption TEXT,
  category TEXT NOT NULL DEFAULT 'progress',
  is_visible BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 6. Homeowner Uploads
CREATE TABLE IF NOT EXISTS public.homeowner_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  portal_user_id UUID NOT NULL REFERENCES homeowner_portal_users(id) ON DELETE CASCADE,
  file_type TEXT NOT NULL DEFAULT 'photo',
  storage_bucket TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  caption TEXT,
  category TEXT DEFAULT 'other',
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 7. Conversations
CREATE TABLE IF NOT EXISTS public.homeowner_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  job_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  subject TEXT,
  is_open BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- 8. Messages
CREATE TABLE IF NOT EXISTS public.homeowner_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES homeowner_conversations(id) ON DELETE CASCADE,
  sender_type TEXT NOT NULL DEFAULT 'system',
  sender_id UUID,
  message_text TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Enable RLS
ALTER TABLE homeowner_portal_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE homeowner_job_access ENABLE ROW LEVEL SECURITY;
ALTER TABLE homeowner_job_public_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE homeowner_timeline_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE homeowner_shared_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE homeowner_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE homeowner_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE homeowner_messages ENABLE ROW LEVEL SECURITY;

-- Basic indexes
CREATE INDEX IF NOT EXISTS idx_ho_portal_users_company ON homeowner_portal_users(company_id);
CREATE INDEX IF NOT EXISTS idx_ho_job_access_job ON homeowner_job_access(job_id);
CREATE INDEX IF NOT EXISTS idx_ho_timeline_job ON homeowner_timeline_events(job_id);
CREATE INDEX IF NOT EXISTS idx_ho_messages_conv ON homeowner_messages(conversation_id);

-- Storage buckets
INSERT INTO storage.buckets (id, name, public) VALUES 
  ('homeowner-shared', 'homeowner-shared', false),
  ('homeowner-uploads', 'homeowner-uploads', false)
ON CONFLICT (id) DO NOTHING;