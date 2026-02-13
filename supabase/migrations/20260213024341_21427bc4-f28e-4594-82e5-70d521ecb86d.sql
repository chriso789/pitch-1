
-- ROI view
CREATE OR REPLACE VIEW canvass_area_roi AS
SELECT
  a.tenant_id,
  ap.area_id,
  j.storm_event_id,
  count(DISTINCT j.id) AS jobs_won,
  sum(coalesce(j.estimated_value, 0)) AS revenue
FROM canvass_areas a
JOIN canvass_area_properties ap ON ap.area_id = a.id AND ap.tenant_id = a.tenant_id
JOIN jobs j ON j.canvass_property_id = ap.property_id AND j.tenant_id = a.tenant_id
GROUP BY a.tenant_id, ap.area_id, j.storm_event_id;

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_canvassiq_properties_lat_lng
  ON canvassiq_properties(tenant_id, lat, lng);

CREATE INDEX IF NOT EXISTS idx_canvassiq_properties_norm_key
  ON canvassiq_properties(tenant_id, normalized_address_key);
