INSERT INTO public.pipeline_stages (tenant_id, key, name, stage_order, is_terminal, is_active, color)
VALUES ('76ee42a0-6e96-4161-a7a6-abbdd3a6017d', 'closed', 'Closed', 11, true, true, '#6b7280')
ON CONFLICT DO NOTHING;