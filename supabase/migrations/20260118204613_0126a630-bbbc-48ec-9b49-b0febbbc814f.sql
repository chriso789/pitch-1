-- Clear sample/test properties that were never building-snapped
-- This allows fresh geocoded data to load when user moves the map
DELETE FROM canvassiq_properties 
WHERE building_snapped = false OR building_snapped IS NULL;