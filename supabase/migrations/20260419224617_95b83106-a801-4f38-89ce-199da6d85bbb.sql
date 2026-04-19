DELETE FROM public.settings_tabs WHERE tab_key = 'payments';
INSERT INTO public.settings_tabs (tab_key, label, description, icon_name, order_index, is_active, required_role)
VALUES (
  'payments',
  'Payments',
  'Connect your company''s Stripe account to receive invoice payments directly to your bank.',
  'CreditCard',
  26,
  true,
  ARRAY['owner','corporate','office_admin','master']
);