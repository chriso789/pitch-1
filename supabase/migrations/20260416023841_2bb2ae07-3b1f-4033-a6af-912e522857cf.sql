-- Add location_id to user_notifications
ALTER TABLE public.user_notifications
ADD COLUMN location_id uuid REFERENCES public.locations(id) ON DELETE SET NULL;

-- Create index for location-based filtering
CREATE INDEX idx_user_notifications_location_id ON public.user_notifications(location_id);

-- Update RLS: users see notifications that either match their location or have no location set
-- First drop existing select policy if any
DO $$
BEGIN
  -- Drop all existing policies on user_notifications to rebuild
  DROP POLICY IF EXISTS "Users can view own notifications" ON public.user_notifications;
  DROP POLICY IF EXISTS "Users can view their own notifications" ON public.user_notifications;
  DROP POLICY IF EXISTS "Users can read own notifications" ON public.user_notifications;
  DROP POLICY IF EXISTS "user_notifications_select" ON public.user_notifications;
END $$;

-- Create new select policy that filters by location for managers
CREATE POLICY "Users see own notifications filtered by location"
ON public.user_notifications
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  AND (
    -- No location on notification = visible to everyone
    location_id IS NULL
    -- Or notification location matches user's active location
    OR location_id = (
      SELECT active_location_id FROM public.profiles WHERE id = auth.uid()
    )
    -- Or user has no active location set (sees all)
    OR (SELECT active_location_id FROM public.profiles WHERE id = auth.uid()) IS NULL
  )
);