
INSERT INTO public.settings_tabs (tab_key, label, description, icon_name, order_index, is_active, required_role)
SELECT 'material-audit', 'Material Audit', 'Audit supplier invoices against price lists', 'ClipboardCheck', 36, true, ARRAY['master', 'owner', 'corporate', 'office_admin', 'regional_manager', 'sales_manager', 'project_manager']
WHERE NOT EXISTS (SELECT 1 FROM public.settings_tabs WHERE tab_key = 'material-audit');
