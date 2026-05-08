
INSERT INTO public.settings_tabs (tab_key, label, description, icon_name, order_index, is_active, required_role)
SELECT 'production-checklist', 'Production Checklist', 'Configure pre-build checklist items for each production stage', 'ClipboardList', 35, true, ARRAY['master', 'owner', 'corporate', 'office_admin', 'regional_manager', 'sales_manager', 'project_manager']
WHERE NOT EXISTS (SELECT 1 FROM public.settings_tabs WHERE tab_key = 'production-checklist');
