alter table public.abc_integrations
  alter column scopes set default 'pricing.read order.read order.write product.read offline_access';

update public.abc_integrations
set scopes = 'pricing.read order.read order.write product.read offline_access',
    updated_at = now()
where scopes = 'pricing.read order.read order.write product.read account.read location.read notification.read notification.write offline_access';