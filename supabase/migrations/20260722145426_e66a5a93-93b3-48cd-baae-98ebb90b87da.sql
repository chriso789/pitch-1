
CREATE OR REPLACE FUNCTION public.resolve_invoice_portal_token(
  _token TEXT,
  _ip_hash TEXT DEFAULT NULL,
  _user_agent_summary TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  _hash TEXT;
  _tok RECORD;
  _inv RECORD;
  _tenant RECORD;
  _contact RECORD;
  _project RECORD;
  _capability TEXT;
  _link_available BOOLEAN;
BEGIN
  IF _token IS NULL OR length(_token) < 20 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_token');
  END IF;

  _hash := encode(extensions.digest(_token, 'sha256'), 'hex');

  SELECT * INTO _tok FROM public.invoice_portal_tokens WHERE token_hash = _hash LIMIT 1;
  IF NOT FOUND OR _tok.revoked_at IS NOT NULL OR _tok.expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_token');
  END IF;

  SELECT * INTO _inv FROM public.invoice_ar_mirror
   WHERE id = _tok.pitch_invoice_id AND tenant_id = _tok.tenant_id LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_token');
  END IF;

  SELECT id, name, logo_url, primary_color, secondary_color, phone, email, website,
         license_number, address_street, address_city, address_state, address_zip
  INTO _tenant FROM public.tenants WHERE id = _tok.tenant_id LIMIT 1;

  IF _tok.contact_id IS NOT NULL THEN
    SELECT id, first_name, last_name, email, phone,
           address_street, address_city, address_state, address_zip
    INTO _contact FROM public.contacts
    WHERE id = _tok.contact_id AND tenant_id = _tok.tenant_id;
  END IF;

  IF _tok.project_id IS NOT NULL THEN
    SELECT id, name INTO _project
    FROM public.projects WHERE id = _tok.project_id AND tenant_id = _tok.tenant_id;
  END IF;

  _link_available := (
    _inv.invoice_link IS NOT NULL
    AND _inv.invoice_link_status = 'available'
    AND COALESCE(_inv.balance, 0) > 0
    AND COALESCE(_inv.qbo_status, '') NOT IN ('Voided','Void')
  );

  IF COALESCE(_inv.balance, 0) <= 0 AND _inv.qbo_status = 'Paid' THEN
    _capability := 'paid';
  ELSIF COALESCE(_inv.qbo_status, '') IN ('Voided','Void') THEN
    _capability := 'void';
  ELSIF _link_available THEN
    _capability := 'pay_available';
  ELSE
    _capability := 'link_unavailable';
  END IF;

  BEGIN
    UPDATE public.invoice_portal_tokens
       SET open_count = open_count + 1,
           first_opened_at = COALESCE(first_opened_at, now()),
           last_opened_at = now(),
           last_ip_hash = COALESCE(_ip_hash, last_ip_hash),
           last_user_agent_summary = COALESCE(_user_agent_summary, last_user_agent_summary),
           updated_at = now()
     WHERE id = _tok.id;

    INSERT INTO public.customer_invoice_events (
      tenant_id, project_id, pitch_invoice_id, contact_id, portal_token_id,
      event_type, actor_type, metadata
    ) VALUES (
      _tok.tenant_id, _tok.project_id, _tok.pitch_invoice_id, _tok.contact_id, _tok.id,
      'invoice_viewed', 'customer',
      jsonb_build_object('ip_hash', _ip_hash, 'ua', _user_agent_summary)
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'token', jsonb_build_object(
      'id', _tok.id,
      'expires_at', _tok.expires_at,
      'first_opened_at', _tok.first_opened_at,
      'open_count', _tok.open_count + 1
    ),
    'tenant', to_jsonb(_tenant),
    'project', CASE WHEN _project.id IS NOT NULL THEN to_jsonb(_project) ELSE NULL END,
    'contact', CASE WHEN _contact.id IS NOT NULL THEN
      jsonb_build_object(
        'first_name', _contact.first_name,
        'last_name', _contact.last_name,
        'email', _contact.email,
        'address_street', _contact.address_street,
        'address_city', _contact.address_city,
        'address_state', _contact.address_state,
        'address_zip', _contact.address_zip
      ) ELSE NULL END,
    'invoice', jsonb_build_object(
      'id', _inv.id,
      'doc_number', _inv.doc_number,
      'invoice_type', _inv.invoice_type,
      'txn_date', _inv.txn_date,
      'due_date', _inv.due_date,
      'total_amount', _inv.total_amount,
      'balance', _inv.balance,
      'amount_paid', GREATEST(COALESCE(_inv.total_amount,0) - COALESCE(_inv.balance,0), 0),
      'qbo_status', _inv.qbo_status,
      'paid_at', _inv.paid_at,
      'last_synced_at', _inv.last_synced_at,
      'payment_capability', _capability,
      'payment_capability_message', _inv.payment_capability_message
    )
  );
END;
$$;
