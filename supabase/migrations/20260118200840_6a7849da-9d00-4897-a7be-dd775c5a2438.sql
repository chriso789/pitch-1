-- Add columns for building footprint snapping
ALTER TABLE canvassiq_properties 
ADD COLUMN IF NOT EXISTS building_snapped boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS original_lat decimal(10,8),
ADD COLUMN IF NOT EXISTS original_lng decimal(11,8);