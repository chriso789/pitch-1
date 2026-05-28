DELETE FROM public.abc_webhook_events WHERE webhook_id::text = '11111111-1111-1111-1111-111111111111';
DELETE FROM public.abc_invoices WHERE invoice_number='SYNTH-INV-001';
DELETE FROM public.abc_orders WHERE raw_payload->>'synthetic' = 'true';
DELETE FROM public.abc_webhooks WHERE raw_payload->>'synthetic' = 'true';