-- Add Email tab to settings_tabs (without ON CONFLICT since no unique constraint exists)
INSERT INTO public.settings_tabs (tab_key, label, description, icon_name, order_index, is_active, required_role)
SELECT 
  'email',
  'Email',
  'Configure company email domain and sending settings',
  'Mail',
  35,
  true,
  ARRAY['master', 'corporate', 'office_admin']
WHERE NOT EXISTS (
  SELECT 1 FROM public.settings_tabs WHERE tab_key = 'email'
);