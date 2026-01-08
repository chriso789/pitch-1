-- Update user_activity_summary view to include password_set_at and is_activated computed column
DROP VIEW IF EXISTS user_activity_summary;

CREATE VIEW user_activity_summary AS
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
    (p.photo_url IS NOT NULL OR p.avatar_url IS NOT NULL) AS has_photo,
    (p.phone IS NOT NULL AND p.phone <> '') AS has_phone,
    (p.title IS NOT NULL AND p.title <> '') AS has_title,
    (SELECT COUNT(*) FROM session_activity_log sal WHERE sal.user_id = p.id AND sal.event_type = 'login_success') AS login_count,
    (SELECT MIN(sal.created_at) FROM session_activity_log sal WHERE sal.user_id = p.id AND sal.event_type = 'login_success') AS first_login_at,
    (SELECT MAX(sal.created_at) FROM session_activity_log sal WHERE sal.user_id = p.id) AS last_session_activity,
    (SELECT COUNT(DISTINCT ual.session_id) FROM user_activity_log ual WHERE ual.user_id = p.id) AS total_sessions,
    (SELECT COUNT(*) FROM user_activity_log ual WHERE ual.user_id = p.id AND ual.action_type = 'page_view') AS page_view_count,
    (SELECT COUNT(*) FROM user_activity_log ual WHERE ual.user_id = p.id AND ual.action_type = 'button_click') AS click_count,
    (SELECT COALESCE(SUM((ual.action_details->>'keystroke_count')::integer), 0) FROM user_activity_log ual WHERE ual.user_id = p.id AND ual.action_type = 'keystroke_batch') AS keystroke_count,
    (SELECT COUNT(*) FROM user_activity_log ual WHERE ual.user_id = p.id AND ual.action_type = 'data_change') AS data_change_count,
    (SELECT COUNT(DISTINCT sal.ip_address) FROM session_activity_log sal WHERE sal.user_id = p.id) AS unique_ip_count,
    (SELECT array_agg(DISTINCT sal.ip_address) FROM session_activity_log sal WHERE sal.user_id = p.id) AS ip_addresses,
    (SELECT array_agg(DISTINCT sal.device_info) FROM session_activity_log sal WHERE sal.user_id = p.id AND sal.device_info IS NOT NULL) AS device_types,
    -- Computed is_activated: true if user has logged in OR has set their password
    CASE 
        WHEN (SELECT COUNT(*) FROM session_activity_log sal WHERE sal.user_id = p.id AND sal.event_type = 'login_success') > 0 THEN true
        WHEN p.password_set_at IS NOT NULL THEN true
        ELSE false
    END AS is_activated
FROM profiles p
LEFT JOIN tenants t ON t.id = p.tenant_id;