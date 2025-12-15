-- Fix the broken trigger function that references non-existent column
CREATE OR REPLACE FUNCTION public.set_location_id_from_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Only set location_id if it's NULL and user is authenticated
    IF NEW.location_id IS NULL AND auth.uid() IS NOT NULL THEN
        SELECT ula.location_id INTO NEW.location_id
        FROM user_location_assignments ula
        WHERE ula.user_id = auth.uid()
          AND ula.is_active = true
        ORDER BY ula.assigned_at ASC NULLS LAST
        LIMIT 1;
    END IF;
    RETURN NEW;
END;
$$;