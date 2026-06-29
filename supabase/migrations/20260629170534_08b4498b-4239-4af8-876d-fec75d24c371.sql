
-- Add QXO integration row and mark all current integrations as sandbox mode
INSERT INTO public.platform_integrations (slug, name, category, description, enabled, sandbox_mode, status, connections_table, docs_url)
VALUES ('qxo', 'QXO (Beacon)', 'supplier', 'Beacon/QXO building products — orders, quotes, invoices, pricing.', true, true, 'operational', 'qxo_connections', 'https://developer.beaconroofingsupply.com')
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  category = EXCLUDED.category,
  description = EXCLUDED.description,
  connections_table = EXCLUDED.connections_table,
  docs_url = EXCLUDED.docs_url;

-- All current external integrations are sandbox today
UPDATE public.platform_integrations
SET sandbox_mode = true
WHERE slug IN ('abc_supply','srs','qxo','quickbooks','centz');
