-- Create duplicate detection tables and functions
CREATE TABLE public.duplicate_detection_rules (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id UUID NOT NULL,
    rule_name TEXT NOT NULL,
    field_name TEXT NOT NULL,
    match_type TEXT NOT NULL CHECK (match_type IN ('exact', 'fuzzy', 'phone_normalized', 'email_normalized')),
    threshold_score NUMERIC(3,2) DEFAULT 0.85,
    is_active BOOLEAN DEFAULT true,
    created_by UUID,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE public.potential_duplicates (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id UUID NOT NULL,
    contact_id_1 UUID NOT NULL,
    contact_id_2 UUID NOT NULL,
    similarity_score NUMERIC(3,2) NOT NULL,
    match_fields JSONB DEFAULT '[]'::jsonb,
    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed_duplicate', 'not_duplicate', 'merged')),
    reviewed_by UUID,
    reviewed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
    UNIQUE(tenant_id, contact_id_1, contact_id_2)
);

CREATE TABLE public.contact_merge_log (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id UUID NOT NULL,
    primary_contact_id UUID NOT NULL,
    merged_contact_id UUID NOT NULL,
    merged_data JSONB NOT NULL,
    merged_by UUID,
    merged_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.duplicate_detection_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.potential_duplicates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_merge_log ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Admins can manage duplicate rules in their tenant" 
ON public.duplicate_detection_rules 
FOR ALL 
USING (tenant_id = get_user_tenant_id() AND (has_role('admin'::app_role) OR has_role('manager'::app_role) OR has_role('master'::app_role)));

CREATE POLICY "Users can view duplicate rules in their tenant" 
ON public.duplicate_detection_rules 
FOR SELECT 
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can manage potential duplicates in their tenant" 
ON public.potential_duplicates 
FOR ALL 
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can view contact merge log in their tenant" 
ON public.contact_merge_log 
FOR SELECT 
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "System can insert merge log in tenant" 
ON public.contact_merge_log 
FOR INSERT 
WITH CHECK (tenant_id = get_user_tenant_id());

-- Create duplicate detection functions
CREATE OR REPLACE FUNCTION public.normalize_phone(phone_text TEXT)
RETURNS TEXT AS $$
BEGIN
    -- Remove all non-numeric characters and normalize to 10 digits for US numbers
    RETURN regexp_replace(phone_text, '[^0-9]', '', 'g');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION public.normalize_email(email_text TEXT)
RETURNS TEXT AS $$
BEGIN
    -- Convert to lowercase and trim whitespace
    RETURN LOWER(TRIM(email_text));
END;
$$ LANGUAGE plpgsql IMMUTABLE;

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
$$ LANGUAGE plpgsql IMMUTABLE;

-- Function to detect duplicates when a contact is inserted/updated
CREATE OR REPLACE FUNCTION public.detect_contact_duplicates()
RETURNS TRIGGER AS $$
DECLARE
    existing_contact RECORD;
    similarity_score NUMERIC;
    match_fields JSONB := '[]'::jsonb;
    total_score NUMERIC := 0;
    field_count INTEGER := 0;
BEGIN
    -- Loop through existing contacts in the same tenant
    FOR existing_contact IN 
        SELECT * FROM public.contacts 
        WHERE tenant_id = NEW.tenant_id 
        AND id != NEW.id
    LOOP
        similarity_score := 0;
        match_fields := '[]'::jsonb;
        field_count := 0;
        
        -- Check email similarity
        IF NEW.email IS NOT NULL AND existing_contact.email IS NOT NULL THEN
            field_count := field_count + 1;
            IF normalize_email(NEW.email) = normalize_email(existing_contact.email) THEN
                similarity_score := similarity_score + 1.0;
                match_fields := match_fields || jsonb_build_array('email');
            END IF;
        END IF;
        
        -- Check phone similarity
        IF NEW.phone IS NOT NULL AND existing_contact.phone IS NOT NULL THEN
            field_count := field_count + 1;
            IF normalize_phone(NEW.phone) = normalize_phone(existing_contact.phone) THEN
                similarity_score := similarity_score + 1.0;
                match_fields := match_fields || jsonb_build_array('phone');
            END IF;
        END IF;
        
        -- Check name similarity
        IF NEW.first_name IS NOT NULL AND NEW.last_name IS NOT NULL 
           AND existing_contact.first_name IS NOT NULL AND existing_contact.last_name IS NOT NULL THEN
            field_count := field_count + 1;
            
            DECLARE
                name_sim NUMERIC;
            BEGIN
                name_sim := (calculate_name_similarity(NEW.first_name, existing_contact.first_name) + 
                            calculate_name_similarity(NEW.last_name, existing_contact.last_name)) / 2;
                
                IF name_sim >= 0.8 THEN
                    similarity_score := similarity_score + name_sim;
                    match_fields := match_fields || jsonb_build_array('name');
                END IF;
            END;
        END IF;
        
        -- Check address similarity (street address)
        IF NEW.address_street IS NOT NULL AND existing_contact.address_street IS NOT NULL THEN
            field_count := field_count + 1;
            IF LOWER(TRIM(NEW.address_street)) = LOWER(TRIM(existing_contact.address_street)) THEN
                similarity_score := similarity_score + 1.0;
                match_fields := match_fields || jsonb_build_array('address');
            END IF;
        END IF;
        
        -- Calculate average similarity
        IF field_count > 0 THEN
            total_score := similarity_score / field_count;
            
            -- If similarity is above threshold, record as potential duplicate
            IF total_score >= 0.7 AND jsonb_array_length(match_fields) > 0 THEN
                INSERT INTO public.potential_duplicates (
                    tenant_id,
                    contact_id_1,
                    contact_id_2,
                    similarity_score,
                    match_fields
                ) VALUES (
                    NEW.tenant_id,
                    LEAST(NEW.id, existing_contact.id),
                    GREATEST(NEW.id, existing_contact.id),
                    total_score,
                    match_fields
                ) ON CONFLICT (tenant_id, contact_id_1, contact_id_2) 
                DO UPDATE SET 
                    similarity_score = EXCLUDED.similarity_score,
                    match_fields = EXCLUDED.match_fields,
                    updated_at = now();
            END IF;
        END IF;
    END LOOP;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Create trigger for duplicate detection
CREATE TRIGGER detect_duplicates_trigger
    AFTER INSERT OR UPDATE OF first_name, last_name, email, phone, address_street
    ON public.contacts
    FOR EACH ROW
    EXECUTE FUNCTION public.detect_contact_duplicates();