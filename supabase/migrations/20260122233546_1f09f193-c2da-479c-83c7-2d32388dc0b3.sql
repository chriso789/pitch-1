-- Recreate remaining views with SECURITY INVOKER

-- 1. user_activity_summary
DROP VIEW IF EXISTS public.user_activity_summary;
CREATE VIEW public.user_activity_summary
WITH (security_invoker = true) AS
SELECT 
  p.id AS user_id,
  p.tenant_id,
  p.first_name,
  p.last_name,
  p.email,
  p.photo_url,
  p.avatar_url,
  p.phone,
  p.title,
  p.is_active,
  p.created_at,
  p.password_set_at,
  t.name AS company_name,
  ((p.photo_url IS NOT NULL) OR (p.avatar_url IS NOT NULL)) AS has_photo,
  ((p.phone IS NOT NULL) AND (p.phone <> '')) AS has_phone,
  ((p.title IS NOT NULL) AND (p.title <> '')) AS has_title,
  (SELECT count(*) FROM session_activity_log sal WHERE sal.user_id = p.id AND sal.event_type = 'login_success') AS login_count,
  (SELECT min(sal.created_at) FROM session_activity_log sal WHERE sal.user_id = p.id AND sal.event_type = 'login_success') AS first_login_at,
  (SELECT max(sal.created_at) FROM session_activity_log sal WHERE sal.user_id = p.id) AS last_session_activity,
  (SELECT count(DISTINCT ual.session_id) FROM user_activity_log ual WHERE ual.user_id = p.id) AS total_sessions,
  (SELECT count(*) FROM user_activity_log ual WHERE ual.user_id = p.id AND ual.action_type = 'page_view') AS page_view_count,
  (SELECT count(*) FROM user_activity_log ual WHERE ual.user_id = p.id AND ual.action_type = 'button_click') AS click_count,
  (SELECT COALESCE(sum((ual.action_details ->> 'keystroke_count')::integer), 0) FROM user_activity_log ual WHERE ual.user_id = p.id AND ual.action_type = 'keystroke_batch') AS keystroke_count,
  (SELECT count(*) FROM user_activity_log ual WHERE ual.user_id = p.id AND ual.action_type = 'data_change') AS data_change_count,
  (SELECT count(DISTINCT sal.ip_address) FROM session_activity_log sal WHERE sal.user_id = p.id) AS unique_ip_count,
  (SELECT array_agg(DISTINCT sal.ip_address) FROM session_activity_log sal WHERE sal.user_id = p.id) AS ip_addresses,
  (SELECT array_agg(DISTINCT sal.device_info) FROM session_activity_log sal WHERE sal.user_id = p.id AND sal.device_info IS NOT NULL) AS device_types,
  CASE
    WHEN (SELECT count(*) FROM session_activity_log sal WHERE sal.user_id = p.id AND sal.event_type = 'login_success') > 0 THEN true
    WHEN p.password_set_at IS NOT NULL THEN true
    ELSE false
  END AS is_activated
FROM profiles p
LEFT JOIN tenants t ON t.id = p.tenant_id;

-- 2. v_ai_aged_contacts
DROP VIEW IF EXISTS public.v_ai_aged_contacts;
CREATE VIEW public.v_ai_aged_contacts
WITH (security_invoker = true) AS
SELECT 
  c.id AS contact_id,
  c.tenant_id,
  c.first_name,
  c.last_name,
  c.phone,
  c.email,
  c.type AS contact_type,
  c.qualification_status,
  c.lead_source,
  COALESCE(GREATEST(max(ui.created_at), max(sm.sent_at), max(ch.created_at)), c.created_at) AS last_activity_at,
  EXTRACT(day FROM (now() - COALESCE(GREATEST(max(ui.created_at), max(sm.sent_at), max(ch.created_at)), c.created_at))) AS days_dormant,
  EXISTS (SELECT 1 FROM ai_contact_memory acm WHERE acm.contact_id = c.id AND 'do_not_contact' = ANY(acm.risk_flags)) AS is_opted_out,
  EXISTS (SELECT 1 FROM ai_outreach_queue aoq WHERE aoq.contact_id = c.id AND aoq.state = ANY(ARRAY['queued', 'running'])) AS has_pending_outreach
FROM contacts c
LEFT JOIN unified_inbox ui ON ui.tenant_id = c.tenant_id AND ui.contact_id = c.id
LEFT JOIN sms_messages sm ON sm.tenant_id = c.tenant_id AND sm.contact_id = c.id
LEFT JOIN communication_history ch ON ch.tenant_id = c.tenant_id AND ch.contact_id = c.id
WHERE c.qualification_status NOT IN ('closed_won', 'closed_lost') OR c.qualification_status IS NULL
GROUP BY c.id, c.tenant_id, c.first_name, c.last_name, c.phone, c.email, c.type, c.qualification_status, c.lead_source, c.created_at;

-- 3. v_unmatched_inbox
DROP VIEW IF EXISTS public.v_unmatched_inbox;
CREATE VIEW public.v_unmatched_inbox
WITH (security_invoker = true) AS
SELECT 
  ui.id,
  ui.tenant_id,
  ui.from_e164,
  ui.to_e164,
  ui.channel,
  ui.body,
  ui.state,
  ui.event_type,
  ui.received_at,
  ui.notes,
  ui.contact_id,
  ui.conversation_id,
  ui.location_id,
  ui.media,
  ui.raw_payload,
  l.name AS location_name,
  l.telnyx_phone_number AS location_did
FROM unmatched_inbound ui
LEFT JOIN locations l ON l.id = ui.location_id;