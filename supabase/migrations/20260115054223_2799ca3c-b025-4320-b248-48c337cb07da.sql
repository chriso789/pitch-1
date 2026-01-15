-- Add section column to material_categories for trade grouping
ALTER TABLE material_categories ADD COLUMN IF NOT EXISTS section TEXT DEFAULT 'roof';

-- Update existing categories with appropriate sections
UPDATE material_categories SET section = 'roof' WHERE section IS NULL;

-- Drop and recreate the RPC function to include section
DROP FUNCTION IF EXISTS api_get_material_categories();

CREATE FUNCTION api_get_material_categories()
RETURNS TABLE (id uuid, code text, name text, description text, order_index int, section text)
LANGUAGE sql SECURITY DEFINER
AS $$
  SELECT id, code, name, description, order_index, COALESCE(section, 'roof') as section
  FROM material_categories 
  WHERE is_active = true
  ORDER BY order_index;
$$;