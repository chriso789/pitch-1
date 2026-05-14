UPDATE tenants
SET brand_stats = jsonb_set(
  brand_stats::jsonb,
  '{0,value}',
  '"5.0★"'
)
WHERE id = '14de934e-7964-4afd-940a-620d2ace125d';