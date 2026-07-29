UPDATE public.settings_tabs
SET required_role = ARRAY['master','owner','corporate','office_admin'],
    label = 'Subscription & Billing',
    order_index = 27
WHERE tab_key = 'subscription';