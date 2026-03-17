INSERT INTO contact_statuses (tenant_id, key, name, color, status_order, is_active)
VALUES ('14de934e-7964-4afd-940a-620d2ace125d', 'go_back', 'Go Back', '#f59e0b', 9, true)
ON CONFLICT DO NOTHING;