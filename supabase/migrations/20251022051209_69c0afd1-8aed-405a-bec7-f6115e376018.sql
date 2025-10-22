-- Create walkthrough_analytics table for tracking user progress
CREATE TABLE IF NOT EXISTS public.walkthrough_analytics (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  step_id TEXT NOT NULL,
  step_number INTEGER NOT NULL,
  completed BOOLEAN NOT NULL DEFAULT false,
  time_spent INTEGER NOT NULL DEFAULT 0,
  dropped_off BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.walkthrough_analytics ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view their own walkthrough analytics"
ON public.walkthrough_analytics
FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own walkthrough analytics"
ON public.walkthrough_analytics
FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own walkthrough analytics"
ON public.walkthrough_analytics
FOR UPDATE
USING (auth.uid() = user_id);

-- Create indexes for better performance
CREATE INDEX idx_walkthrough_analytics_user_id ON public.walkthrough_analytics(user_id);
CREATE INDEX idx_walkthrough_analytics_tenant_id ON public.walkthrough_analytics(tenant_id);
CREATE INDEX idx_walkthrough_analytics_step_number ON public.walkthrough_analytics(step_number);

-- Create trigger for automatic timestamp updates
CREATE TRIGGER update_walkthrough_analytics_updated_at
BEFORE UPDATE ON public.walkthrough_analytics
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();