-- Create crews/resources table
CREATE TABLE public.crews (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL,
  skills JSONB NOT NULL DEFAULT '[]'::jsonb,
  capacity_slots INTEGER NOT NULL DEFAULT 1,
  hourly_rate DECIMAL(10,2) DEFAULT 0,
  color TEXT DEFAULT '#3b82f6',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create task dependencies tracking
CREATE TABLE public.task_dependencies (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  task_id UUID NOT NULL,
  depends_on_task_id UUID NOT NULL,
  dependency_type TEXT NOT NULL DEFAULT 'finish_to_start',
  lag_days INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  CONSTRAINT dependency_type_check CHECK (dependency_type IN ('finish_to_start', 'start_to_start', 'finish_to_finish', 'start_to_finish')),
  UNIQUE(task_id, depends_on_task_id)
);

-- Create crew availability/capacity tracking
CREATE TABLE public.crew_availability (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  crew_id UUID NOT NULL,
  date DATE NOT NULL,
  available_slots INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  UNIQUE(tenant_id, crew_id, date)
);

-- Create calendar sync tracking
CREATE TABLE public.calendar_sync_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  task_id UUID NOT NULL,
  google_calendar_event_id TEXT,
  sync_status TEXT NOT NULL DEFAULT 'pending',
  last_synced_at TIMESTAMP WITH TIME ZONE,
  sync_error TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  CONSTRAINT sync_status_check CHECK (sync_status IN ('pending', 'synced', 'failed', 'deleted'))
);

-- Enable RLS on new tables
ALTER TABLE public.crews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crew_availability ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calendar_sync_events ENABLE ROW LEVEL SECURITY;