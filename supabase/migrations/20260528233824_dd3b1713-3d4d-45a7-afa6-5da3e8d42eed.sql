INSERT INTO public.abc_webhooks
  (id, tenant_id, name, webhook_type, events, url, status, environment, secret, webhook_id, raw_payload, active_since)
VALUES
  ('11111111-1111-1111-1111-111111111111',
   '14de934e-7964-4afd-940a-620d2ace125d',
   'synthetic-test',
   'ORDER',
   ARRAY['ORDER_UPDATE','ORDER_INVOICED'],
   'https://example.invalid/abc/events/11111111-1111-1111-1111-111111111111',
   'active',
   'sandbox',
   'synthetic-secret-abc-12345',
   'abc-wh-synth-1',
   '{"synthetic":"true"}'::jsonb,
   now());

INSERT INTO public.abc_orders
  (tenant_id, order_number, purchase_order, confirmation_number, order_status, source, currency, ordered_on, total_amount, raw_payload)
VALUES
  ('14de934e-7964-4afd-940a-620d2ace125d',
   'SYNTH-ORDER-001',
   'SYNTH-PO-001',
   'SYNTH-CONF-001',
   'submitted',
   'pitch',
   'USD',
   CURRENT_DATE,
   100.00,
   '{"synthetic":"true"}'::jsonb);
