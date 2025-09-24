-- Fix security warnings by setting proper search_path for functions
CREATE OR REPLACE FUNCTION public.normalize_phone(phone_text TEXT)
RETURNS TEXT AS $$
BEGIN
    -- Remove all non-numeric characters and normalize to 10 digits for US numbers
    RETURN regexp_replace(phone_text, '[^0-9]', '', 'g');
END;
$$ LANGUAGE plpgsql IMMUTABLE SET search_path = public;

CREATE OR REPLACE FUNCTION public.normalize_email(email_text TEXT)
RETURNS TEXT AS $$
BEGIN
    -- Convert to lowercase and trim whitespace
    RETURN LOWER(TRIM(email_text));
END;
$$ LANGUAGE plpgsql IMMUTABLE SET search_path = public;

CREATE OR REPLACE FUNCTION public.calculate_name_similarity(name1 TEXT, name2 TEXT)
RETURNS NUMERIC AS $$
BEGIN
    -- Simple Levenshtein-like similarity calculation
    -- Return 1.0 for exact match, 0.0 for completely different
    IF name1 IS NULL OR name2 IS NULL THEN
        RETURN 0.0;
    END IF;
    
    -- Normalize names (lowercase, trim)
    name1 := LOWER(TRIM(name1));
    name2 := LOWER(TRIM(name2));
    
    -- Exact match
    IF name1 = name2 THEN
        RETURN 1.0;
    END IF;
    
    -- Simple substring matching for now
    IF name1 LIKE '%' || name2 || '%' OR name2 LIKE '%' || name1 || '%' THEN
        RETURN 0.8;
    END IF;
    
    RETURN 0.0;
END;
$$ LANGUAGE plpgsql IMMUTABLE SET search_path = public;