
ALTER TABLE public.tenants
ADD COLUMN IF NOT EXISTS proposal_template_style TEXT NOT NULL DEFAULT 'bold-editorial';
