-- Create overloaded format_clj_number function that accepts TEXT arguments
-- This fixes the "function format_clj_number(text) does not exist" error during contact import

CREATE OR REPLACE FUNCTION public.format_clj_number(
  contact_num TEXT,
  lead_num TEXT DEFAULT '0',
  job_num TEXT DEFAULT '0'
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
BEGIN
  RETURN format('%s-%s-%s', 
    COALESCE(NULLIF(contact_num, '')::INTEGER, 0), 
    COALESCE(NULLIF(lead_num, '')::INTEGER, 0), 
    COALESCE(NULLIF(job_num, '')::INTEGER, 0)
  );
END;
$$;