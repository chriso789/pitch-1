-- Clear current rate limit entries to immediately unblock users hitting the limit
DELETE FROM rate_limits WHERE resource = 'google_maps_proxy';