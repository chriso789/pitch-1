UPDATE public.srs_connections
SET environment = 'production',
    access_token = NULL,
    token_expires_at = NULL,
    connection_status = 'disconnected',
    valid_indicator = false,
    last_error = 'Flipped to production — please re-validate with production credentials.',
    updated_at = now()
WHERE tenant_id = '14de934e-7964-4afd-940a-620d2ace125d';