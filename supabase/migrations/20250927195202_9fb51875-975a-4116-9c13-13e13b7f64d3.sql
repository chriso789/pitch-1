-- Create native digital signature system schema (fixed)

-- Create signature templates table
CREATE TABLE public.signature_templates (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id UUID NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    template_type TEXT NOT NULL DEFAULT 'estimate', -- estimate, contract, proposal
    liquid_template TEXT NOT NULL, -- Liquid template for PDF generation
    signature_fields JSONB NOT NULL DEFAULT '[]'::jsonb, -- Field definitions
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_by UUID,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create signature envelopes table
CREATE TABLE public.signature_envelopes (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id UUID NOT NULL,
    envelope_number TEXT, -- Will be set by trigger
    template_id UUID REFERENCES public.signature_templates(id),
    estimate_id UUID, -- References estimates
    contact_id UUID, 
    project_id UUID,
    pipeline_entry_id UUID,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'draft', -- draft, sent, viewed, partially_signed, completed, voided
    generated_pdf_path TEXT, -- Path to generated PDF
    signed_pdf_path TEXT, -- Path to final signed PDF
    sent_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    expires_at TIMESTAMP WITH TIME ZONE,
    created_by UUID,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create signature recipients table
CREATE TABLE public.signature_recipients (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id UUID NOT NULL,
    envelope_id UUID NOT NULL REFERENCES public.signature_envelopes(id) ON DELETE CASCADE,
    recipient_name TEXT NOT NULL,
    recipient_email TEXT NOT NULL,
    recipient_role TEXT NOT NULL DEFAULT 'signer', -- signer, cc, approver
    signing_order INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'pending', -- pending, sent, viewed, signed, declined
    access_token TEXT, -- Unique token for accessing signing session
    signed_at TIMESTAMP WITH TIME ZONE,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    UNIQUE(envelope_id, recipient_email)
);

-- Create signature fields table (dynamic content for each envelope)
CREATE TABLE public.signature_fields (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id UUID NOT NULL,
    envelope_id UUID NOT NULL REFERENCES public.signature_envelopes(id) ON DELETE CASCADE,
    field_key TEXT NOT NULL,
    field_value TEXT,
    field_type TEXT NOT NULL DEFAULT 'text', -- text, signature, date, checkbox
    recipient_id UUID, -- Which recipient should fill this field
    page_number INTEGER DEFAULT 1,
    x_position INTEGER,
    y_position INTEGER,
    width INTEGER,
    height INTEGER,
    is_required BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    UNIQUE(envelope_id, field_key)
);

-- Create digital signatures table
CREATE TABLE public.digital_signatures (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id UUID NOT NULL,
    envelope_id UUID NOT NULL REFERENCES public.signature_envelopes(id) ON DELETE CASCADE,
    recipient_id UUID NOT NULL REFERENCES public.signature_recipients(id) ON DELETE CASCADE,
    field_id UUID REFERENCES public.signature_fields(id),
    signature_data TEXT NOT NULL, -- Base64 encoded signature image
    signature_hash TEXT NOT NULL, -- Cryptographic hash for verification
    signature_metadata JSONB DEFAULT '{}', -- Device info, timestamp, etc.
    signed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
    ip_address INET,
    is_valid BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create signature events table (audit trail)
CREATE TABLE public.signature_events (
    id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
    tenant_id UUID NOT NULL,
    envelope_id UUID NOT NULL REFERENCES public.signature_envelopes(id) ON DELETE CASCADE,
    recipient_id UUID REFERENCES public.signature_recipients(id),
    event_type TEXT NOT NULL, -- created, sent, viewed, signed, completed, declined, voided
    event_description TEXT,
    event_metadata JSONB DEFAULT '{}',
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create sequence for envelope numbers
CREATE SEQUENCE IF NOT EXISTS envelope_number_seq START 1;

-- Create function to generate envelope numbers
CREATE OR REPLACE FUNCTION public.generate_envelope_number()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    next_num INTEGER;
    envelope_num TEXT;
BEGIN
    next_num := nextval('envelope_number_seq');
    envelope_num := 'ENV-' || LPAD(next_num::TEXT, 5, '0');
    RETURN envelope_num;
END;
$$;

-- Create trigger to auto-assign envelope numbers
CREATE OR REPLACE FUNCTION public.auto_assign_envelope_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF NEW.envelope_number IS NULL THEN
        NEW.envelope_number := generate_envelope_number();
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trigger_auto_assign_envelope_number
    BEFORE INSERT ON public.signature_envelopes
    FOR EACH ROW
    EXECUTE FUNCTION public.auto_assign_envelope_number();

-- Enable RLS
ALTER TABLE public.signature_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signature_envelopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signature_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signature_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.digital_signatures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signature_events ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Users can manage signature templates in their tenant" ON public.signature_templates
    FOR ALL USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can manage signature envelopes in their tenant" ON public.signature_envelopes
    FOR ALL USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can view signature recipients in their tenant" ON public.signature_recipients
    FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY "System can manage signature recipients" ON public.signature_recipients
    FOR INSERT WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "System can update signature recipients" ON public.signature_recipients
    FOR UPDATE USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can manage signature fields in their tenant" ON public.signature_fields
    FOR ALL USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can view digital signatures in their tenant" ON public.digital_signatures
    FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY "System can create digital signatures" ON public.digital_signatures
    FOR INSERT WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "Users can view signature events in their tenant" ON public.signature_events
    FOR SELECT USING (tenant_id = get_user_tenant_id());

CREATE POLICY "System can create signature events" ON public.signature_events
    FOR INSERT WITH CHECK (tenant_id = get_user_tenant_id());

-- Create indexes
CREATE INDEX idx_signature_templates_tenant ON public.signature_templates(tenant_id);
CREATE INDEX idx_signature_envelopes_tenant ON public.signature_envelopes(tenant_id);
CREATE INDEX idx_signature_envelopes_status ON public.signature_envelopes(tenant_id, status);
CREATE INDEX idx_signature_recipients_envelope ON public.signature_recipients(envelope_id);
CREATE INDEX idx_signature_recipients_access_token ON public.signature_recipients(access_token);
CREATE INDEX idx_signature_fields_envelope ON public.signature_fields(envelope_id);
CREATE INDEX idx_digital_signatures_envelope ON public.digital_signatures(envelope_id);
CREATE INDEX idx_signature_events_envelope ON public.signature_events(envelope_id);

-- Create function to generate access tokens
CREATE OR REPLACE FUNCTION public.generate_signature_access_token()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    RETURN encode(gen_random_bytes(32), 'hex');
END;
$$;

-- Create function to log signature events
CREATE OR REPLACE FUNCTION public.log_signature_event(
    p_envelope_id UUID,
    p_recipient_id UUID,
    p_event_type TEXT,
    p_description TEXT DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tenant_id UUID;
    v_event_id UUID;
BEGIN
    -- Get tenant_id from envelope
    SELECT tenant_id INTO v_tenant_id
    FROM public.signature_envelopes
    WHERE id = p_envelope_id;
    
    -- Insert event
    INSERT INTO public.signature_events (
        tenant_id,
        envelope_id,
        recipient_id,
        event_type,
        event_description,
        event_metadata
    ) VALUES (
        v_tenant_id,
        p_envelope_id,
        p_recipient_id,
        p_event_type,
        p_description,
        p_metadata
    ) RETURNING id INTO v_event_id;
    
    RETURN v_event_id;
END;
$$;