-- Create user activity summary view for efficient dashboard loading
-- The function was already created successfully, just need the view fixed

CREATE OR REPLACE VIEW public.user_activity_summary AS
SELECT 
  p.id as user_id,
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
  t.name as company_name,
  -- Profile completion checks
  (p.photo_url IS NOT NULL OR p.avatar_url IS NOT NULL) as has_photo,
  (p.phone IS NOT NULL AND p.phone != '') as has_phone,
  (p.title IS NOT NULL AND p.title != '') as has_title,
  -- Login stats from session_activity_log
  (SELECT COUNT(*) FROM session_activity_log sal 
   WHERE sal.user_id = p.id AND sal.event_type = 'login_success') as login_count,
  (SELECT MIN(created_at) FROM session_activity_log sal 
   WHERE sal.user_id = p.id AND sal.event_type = 'login_success') as first_login_at,
  (SELECT MAX(created_at) FROM session_activity_log sal 
   WHERE sal.user_id = p.id) as last_session_activity,
  -- Activity stats from user_activity_log  
  (SELECT COUNT(DISTINCT session_id) FROM user_activity_log ual 
   WHERE ual.user_id = p.id) as total_sessions,
  (SELECT COUNT(*) FROM user_activity_log ual 
   WHERE ual.user_id = p.id AND ual.action_type = 'page_view') as page_view_count,
  (SELECT COUNT(*) FROM user_activity_log ual 
   WHERE ual.user_id = p.id AND ual.action_type = 'button_click') as click_count,
  (SELECT COALESCE(SUM((action_details->>'keystroke_count')::int), 0) 
   FROM user_activity_log ual 
   WHERE ual.user_id = p.id AND ual.action_type = 'keystroke_batch') as keystroke_count,
  (SELECT COUNT(*) FROM user_activity_log ual 
   WHERE ual.user_id = p.id AND ual.action_type = 'data_change') as data_change_count,
  -- Access location data
  (SELECT COUNT(DISTINCT ip_address) FROM session_activity_log sal 
   WHERE sal.user_id = p.id) as unique_ip_count,
  (SELECT ARRAY_AGG(DISTINCT ip_address::text) FROM session_activity_log sal 
   WHERE sal.user_id = p.id) as ip_addresses,
  -- Device info stored as text, parse directly
  (SELECT ARRAY_AGG(DISTINCT device_info) FROM session_activity_log sal 
   WHERE sal.user_id = p.id AND device_info IS NOT NULL) as device_types
FROM profiles p
LEFT JOIN tenants t ON t.id = p.tenant_id;

-- Add comment to document the view
COMMENT ON VIEW public.user_activity_summary IS 'Aggregated user activity data for admin dashboard. Access controlled by can_view_user_activity function.';