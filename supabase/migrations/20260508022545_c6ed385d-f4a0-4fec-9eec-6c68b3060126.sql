INSERT INTO public.settings_tabs (tab_key, label, description, icon_name, order_index, required_role, is_active)
SELECT 'my-money', 'My Money', 'Track commissions & draws', 'Wallet', 37, '{"master","owner","corporate","office_admin","regional_manager","sales_manager","project_manager"}'::text[], true
WHERE NOT EXISTS (SELECT 1 FROM public.settings_tabs WHERE tab_key = 'my-money');