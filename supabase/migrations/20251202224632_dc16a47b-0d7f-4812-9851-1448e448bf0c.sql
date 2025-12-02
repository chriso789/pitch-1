
-- ============================================================================
-- Materials Database Infrastructure
-- Global catalog for roofing materials with smart line item editing
-- ============================================================================

-- 1. Material Categories (global across all locations)
CREATE TABLE IF NOT EXISTS public.material_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  order_index INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Materials (global catalog - editable smart line items)
CREATE TABLE IF NOT EXISTS public.materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT,
  category_id UUID REFERENCES public.material_categories(id),
  uom TEXT NOT NULL DEFAULT 'EA',
  coverage_per_unit DECIMAL(10,2),
  base_cost DECIMAL(10,2),
  default_markup_pct DECIMAL(5,4) DEFAULT 0.35,
  is_taxable BOOLEAN DEFAULT true,
  tags TEXT[],
  attributes JSONB DEFAULT '{}',
  supplier_sku TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Supplier Catalogs (vendor price lists)
CREATE TABLE IF NOT EXISTS public.supplier_catalogs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_name TEXT NOT NULL,
  region TEXT,
  last_sync_at TIMESTAMPTZ,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Supplier Catalog Items (imported supplier price lists)
CREATE TABLE IF NOT EXISTS public.supplier_catalog_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  catalog_id UUID REFERENCES public.supplier_catalogs(id),
  sku TEXT NOT NULL,
  brand TEXT,
  model TEXT,
  description TEXT,
  category TEXT,
  uom TEXT DEFAULT 'EA',
  package_size TEXT,
  base_price DECIMAL(10,2),
  price_effective_date DATE,
  attributes JSONB DEFAULT '{}',
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_materials_category ON public.materials(category_id);
CREATE INDEX IF NOT EXISTS idx_materials_code ON public.materials(code);
CREATE INDEX IF NOT EXISTS idx_materials_active ON public.materials(active);
CREATE INDEX IF NOT EXISTS idx_supplier_catalog_items_catalog ON public.supplier_catalog_items(catalog_id);
CREATE INDEX IF NOT EXISTS idx_supplier_catalog_items_sku ON public.supplier_catalog_items(sku);

-- Seed default roofing categories
INSERT INTO public.material_categories (code, name, description, order_index) VALUES
  ('SHINGLES', 'Shingles', 'Asphalt, architectural, and designer shingles', 1),
  ('UNDERLAYMENT', 'Underlayment', 'Synthetic and felt underlayment products', 2),
  ('ICE_WATER', 'Ice & Water Shield', 'Self-adhering waterproofing membranes', 3),
  ('STARTER', 'Starter Strips', 'Starter shingles for eaves and rakes', 4),
  ('RIDGE_HIP', 'Ridge & Hip Caps', 'Ridge cap and hip cap shingles', 5),
  ('VENTILATION', 'Ventilation', 'Ridge vents, box vents, and intake vents', 6),
  ('FLASHING', 'Flashing & Metals', 'Step flashing, pipe boots, and metal components', 7),
  ('DRIP_EDGE', 'Drip Edge', 'Metal drip edge profiles', 8),
  ('FASTENERS', 'Nails & Fasteners', 'Roofing nails, screws, and fasteners', 9),
  ('ACCESSORIES', 'Accessories', 'Sealants, caulk, and misc supplies', 10),
  ('LABOR', 'Labor', 'Labor line items for estimates', 11)
ON CONFLICT (code) DO NOTHING;

-- Create Sunniland catalog
INSERT INTO public.supplier_catalogs (supplier_name, region) 
VALUES ('Sunniland Supply', 'Florida')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- RPC Functions
-- ============================================================================

-- Get or create Sunniland catalog ID
CREATE OR REPLACE FUNCTION public.api_sunniland_catalog_id()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_catalog_id UUID;
BEGIN
  SELECT id INTO v_catalog_id 
  FROM public.supplier_catalogs 
  WHERE supplier_name = 'Sunniland Supply' 
  LIMIT 1;
  
  IF v_catalog_id IS NULL THEN
    INSERT INTO public.supplier_catalogs (supplier_name, region)
    VALUES ('Sunniland Supply', 'Florida')
    RETURNING id INTO v_catalog_id;
  END IF;
  
  RETURN v_catalog_id;
END;
$$;

-- Upsert material (insert or update)
CREATE OR REPLACE FUNCTION public.api_upsert_material(
  p_code TEXT,
  p_name TEXT,
  p_category_id UUID DEFAULT NULL,
  p_uom TEXT DEFAULT 'EA',
  p_base_cost DECIMAL DEFAULT NULL,
  p_default_markup_pct DECIMAL DEFAULT 0.35,
  p_coverage_per_unit DECIMAL DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_supplier_sku TEXT DEFAULT NULL,
  p_tags TEXT[] DEFAULT NULL,
  p_attributes JSONB DEFAULT '{}'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_material_id UUID;
BEGIN
  INSERT INTO public.materials (
    code, name, category_id, uom, base_cost, default_markup_pct,
    coverage_per_unit, description, supplier_sku, tags, attributes
  ) VALUES (
    p_code, p_name, p_category_id, p_uom, p_base_cost, p_default_markup_pct,
    p_coverage_per_unit, p_description, p_supplier_sku, p_tags, p_attributes
  )
  ON CONFLICT (code) DO UPDATE SET
    name = EXCLUDED.name,
    category_id = COALESCE(EXCLUDED.category_id, materials.category_id),
    uom = EXCLUDED.uom,
    base_cost = COALESCE(EXCLUDED.base_cost, materials.base_cost),
    default_markup_pct = EXCLUDED.default_markup_pct,
    coverage_per_unit = COALESCE(EXCLUDED.coverage_per_unit, materials.coverage_per_unit),
    description = COALESCE(EXCLUDED.description, materials.description),
    supplier_sku = COALESCE(EXCLUDED.supplier_sku, materials.supplier_sku),
    tags = COALESCE(EXCLUDED.tags, materials.tags),
    attributes = materials.attributes || EXCLUDED.attributes,
    updated_at = NOW()
  RETURNING id INTO v_material_id;
  
  RETURN v_material_id;
END;
$$;

-- Get all materials with category info
CREATE OR REPLACE FUNCTION public.api_get_materials()
RETURNS TABLE (
  id UUID,
  code TEXT,
  name TEXT,
  description TEXT,
  category_id UUID,
  category_name TEXT,
  category_code TEXT,
  uom TEXT,
  coverage_per_unit DECIMAL,
  base_cost DECIMAL,
  default_markup_pct DECIMAL,
  is_taxable BOOLEAN,
  tags TEXT[],
  supplier_sku TEXT,
  active BOOLEAN
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT 
    m.id,
    m.code,
    m.name,
    m.description,
    m.category_id,
    c.name as category_name,
    c.code as category_code,
    m.uom,
    m.coverage_per_unit,
    m.base_cost,
    m.default_markup_pct,
    m.is_taxable,
    m.tags,
    m.supplier_sku,
    m.active
  FROM public.materials m
  LEFT JOIN public.material_categories c ON c.id = m.category_id
  WHERE m.active = true
  ORDER BY c.order_index, m.name;
$$;

-- Get all categories
CREATE OR REPLACE FUNCTION public.api_get_material_categories()
RETURNS TABLE (
  id UUID,
  code TEXT,
  name TEXT,
  description TEXT,
  order_index INTEGER
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT id, code, name, description, order_index
  FROM public.material_categories
  WHERE is_active = true
  ORDER BY order_index;
$$;

-- Bulk import materials from CSV data
CREATE OR REPLACE FUNCTION public.api_bulk_import_materials(p_materials JSONB)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_count INTEGER := 0;
  v_item JSONB;
  v_category_id UUID;
BEGIN
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_materials)
  LOOP
    -- Find category by code or name
    SELECT id INTO v_category_id 
    FROM public.material_categories 
    WHERE code = UPPER(v_item->>'category') 
       OR name ILIKE v_item->>'category'
    LIMIT 1;
    
    -- Insert/update material
    PERFORM public.api_upsert_material(
      p_code := v_item->>'code',
      p_name := v_item->>'name',
      p_category_id := v_category_id,
      p_uom := COALESCE(v_item->>'uom', 'EA'),
      p_base_cost := (v_item->>'base_cost')::DECIMAL,
      p_default_markup_pct := COALESCE((v_item->>'markup_pct')::DECIMAL, 0.35),
      p_coverage_per_unit := (v_item->>'coverage')::DECIMAL,
      p_description := v_item->>'description',
      p_supplier_sku := v_item->>'sku',
      p_tags := ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_item->'tags', '[]'::jsonb)))
    );
    
    v_count := v_count + 1;
  END LOOP;
  
  RETURN v_count;
END;
$$;
