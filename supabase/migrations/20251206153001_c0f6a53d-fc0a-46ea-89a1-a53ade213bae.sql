-- ============================================================================
-- Florida County Permit Requirements System
-- Creates tables for tracking permit requirements across 35 Florida coastal counties
-- ============================================================================

-- 1. Florida counties master list
CREATE TABLE florida_counties (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  coast TEXT NOT NULL CHECK (coast IN ('east', 'west', 'panhandle', 'keys', 'nature_coast')),
  region TEXT,
  population INTEGER,
  is_hvhz BOOLEAN DEFAULT false,
  wind_zone TEXT,
  timezone TEXT DEFAULT 'America/New_York',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 2. Permit requirements per county
CREATE TABLE county_permit_requirements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  county_id UUID REFERENCES florida_counties(id) ON DELETE CASCADE,
  permit_type TEXT NOT NULL DEFAULT 'residential_reroof',
  online_submission BOOLEAN DEFAULT false,
  in_person_required BOOLEAN DEFAULT false,
  permit_portal_url TEXT,
  required_documents JSONB DEFAULT '[]',
  base_fee DECIMAL(10,2),
  per_sqft_fee DECIMAL(10,4),
  plan_review_fee DECIMAL(10,2),
  typical_processing_days INTEGER,
  expedited_available BOOLEAN DEFAULT false,
  expedited_fee DECIMAL(10,2),
  special_requirements TEXT[],
  department_name TEXT,
  department_phone TEXT,
  department_email TEXT,
  department_address TEXT,
  notes TEXT,
  last_scraped_at TIMESTAMPTZ,
  last_verified_at DATE,
  scrape_source_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 3. Downloadable forms per county
CREATE TABLE county_permit_forms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  county_id UUID REFERENCES florida_counties(id) ON DELETE CASCADE,
  form_name TEXT NOT NULL,
  form_url TEXT,
  form_type TEXT CHECK (form_type IN ('application', 'affidavit', 'checklist', 'notice', 'other')),
  is_required BOOLEAN DEFAULT true,
  notes TEXT,
  last_verified_at DATE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes for performance
CREATE INDEX idx_florida_counties_coast ON florida_counties(coast);
CREATE INDEX idx_florida_counties_name ON florida_counties(name);
CREATE INDEX idx_county_permit_requirements_county ON county_permit_requirements(county_id);
CREATE INDEX idx_county_permit_requirements_type ON county_permit_requirements(permit_type);
CREATE INDEX idx_county_permit_forms_county ON county_permit_forms(county_id);

-- Enable RLS
ALTER TABLE florida_counties ENABLE ROW LEVEL SECURITY;
ALTER TABLE county_permit_requirements ENABLE ROW LEVEL SECURITY;
ALTER TABLE county_permit_forms ENABLE ROW LEVEL SECURITY;

-- RLS Policies - Public read access for all authenticated users
CREATE POLICY "Anyone can view florida_counties" ON florida_counties FOR SELECT USING (true);
CREATE POLICY "Anyone can view county_permit_requirements" ON county_permit_requirements FOR SELECT USING (true);
CREATE POLICY "Anyone can view county_permit_forms" ON county_permit_forms FOR SELECT USING (true);

-- Master users can manage all permit data
CREATE POLICY "Master users can insert florida_counties" ON florida_counties FOR INSERT 
WITH CHECK (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'master'));

CREATE POLICY "Master users can update florida_counties" ON florida_counties FOR UPDATE 
USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'master'));

CREATE POLICY "Master users can delete florida_counties" ON florida_counties FOR DELETE 
USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'master'));

CREATE POLICY "Master users can insert county_permit_requirements" ON county_permit_requirements FOR INSERT 
WITH CHECK (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'master'));

CREATE POLICY "Master users can update county_permit_requirements" ON county_permit_requirements FOR UPDATE 
USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'master'));

CREATE POLICY "Master users can delete county_permit_requirements" ON county_permit_requirements FOR DELETE 
USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'master'));

CREATE POLICY "Master users can insert county_permit_forms" ON county_permit_forms FOR INSERT 
WITH CHECK (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'master'));

CREATE POLICY "Master users can update county_permit_forms" ON county_permit_forms FOR UPDATE 
USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'master'));

CREATE POLICY "Master users can delete county_permit_forms" ON county_permit_forms FOR DELETE 
USING (EXISTS (SELECT 1 FROM user_roles WHERE user_id = auth.uid() AND role = 'master'));

-- Updated_at trigger
CREATE OR REPLACE FUNCTION update_florida_counties_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_florida_counties_timestamp
  BEFORE UPDATE ON florida_counties
  FOR EACH ROW EXECUTE FUNCTION update_florida_counties_updated_at();

CREATE TRIGGER update_county_permit_requirements_timestamp
  BEFORE UPDATE ON county_permit_requirements
  FOR EACH ROW EXECUTE FUNCTION update_florida_counties_updated_at();

-- ============================================================================
-- SEED DATA: 35 Florida Coastal Counties
-- ============================================================================

-- East Coast (Atlantic) - 12 counties
INSERT INTO florida_counties (name, coast, region, is_hvhz, wind_zone) VALUES
  ('Miami-Dade', 'east', 'Gold Coast', true, '170mph'),
  ('Broward', 'east', 'Gold Coast', true, '150mph'),
  ('Palm Beach', 'east', 'Gold Coast', false, '150mph'),
  ('Martin', 'east', 'Treasure Coast', false, '140mph'),
  ('St. Lucie', 'east', 'Treasure Coast', false, '140mph'),
  ('Indian River', 'east', 'Treasure Coast', false, '130mph'),
  ('Brevard', 'east', 'Space Coast', false, '130mph'),
  ('Volusia', 'east', 'Fun Coast', false, '120mph'),
  ('Flagler', 'east', 'Fun Coast', false, '120mph'),
  ('St. Johns', 'east', 'First Coast', false, '120mph'),
  ('Duval', 'east', 'First Coast', false, '110mph'),
  ('Nassau', 'east', 'First Coast', false, '110mph');

-- West Coast (Gulf) - 7 counties
INSERT INTO florida_counties (name, coast, region, is_hvhz, wind_zone) VALUES
  ('Pinellas', 'west', 'Sun Coast', false, '130mph'),
  ('Hillsborough', 'west', 'Sun Coast', false, '120mph'),
  ('Manatee', 'west', 'Sun Coast', false, '130mph'),
  ('Sarasota', 'west', 'Sun Coast', false, '130mph'),
  ('Charlotte', 'west', 'Paradise Coast', false, '140mph'),
  ('Lee', 'west', 'Paradise Coast', true, '150mph'),
  ('Collier', 'west', 'Paradise Coast', false, '150mph');

-- Panhandle - 8 counties
INSERT INTO florida_counties (name, coast, region, is_hvhz, wind_zone, timezone) VALUES
  ('Escambia', 'panhandle', 'Emerald Coast', false, '140mph', 'America/Chicago'),
  ('Santa Rosa', 'panhandle', 'Emerald Coast', false, '140mph', 'America/Chicago'),
  ('Okaloosa', 'panhandle', 'Emerald Coast', false, '130mph', 'America/Chicago'),
  ('Walton', 'panhandle', 'Emerald Coast', false, '130mph', 'America/Chicago'),
  ('Bay', 'panhandle', 'Forgotten Coast', false, '140mph', 'America/Chicago'),
  ('Gulf', 'panhandle', 'Forgotten Coast', false, '130mph', 'America/Chicago'),
  ('Franklin', 'panhandle', 'Forgotten Coast', false, '120mph', 'America/New_York'),
  ('Wakulla', 'panhandle', 'Forgotten Coast', false, '110mph', 'America/New_York');

-- Nature Coast - 7 counties
INSERT INTO florida_counties (name, coast, region, is_hvhz, wind_zone) VALUES
  ('Jefferson', 'nature_coast', 'Nature Coast', false, '110mph'),
  ('Taylor', 'nature_coast', 'Nature Coast', false, '110mph'),
  ('Dixie', 'nature_coast', 'Nature Coast', false, '110mph'),
  ('Levy', 'nature_coast', 'Nature Coast', false, '110mph'),
  ('Citrus', 'nature_coast', 'Nature Coast', false, '120mph'),
  ('Hernando', 'nature_coast', 'Nature Coast', false, '120mph'),
  ('Pasco', 'nature_coast', 'Nature Coast', false, '120mph');

-- Florida Keys - 1 county
INSERT INTO florida_counties (name, coast, region, is_hvhz, wind_zone) VALUES
  ('Monroe', 'keys', 'Florida Keys', true, '180mph');

-- ============================================================================
-- SEED: Default permit requirements for major counties
-- ============================================================================

-- Miami-Dade (HVHZ - strictest requirements)
INSERT INTO county_permit_requirements (
  county_id, permit_type, online_submission, permit_portal_url, 
  required_documents, base_fee, typical_processing_days, 
  special_requirements, department_name, department_phone
) VALUES (
  (SELECT id FROM florida_counties WHERE name = 'Miami-Dade'),
  'residential_reroof', true,
  'https://www.miamidade.gov/global/economy/building/roofing-permits.page',
  '["Permit Application", "Roof Plan with dimensions", "Product Approval Numbers (NOA)", "Engineered sealed calculations", "Notice of Commencement", "HVHZ Compliance Affidavit", "Wind Mitigation Form", "FBC Product Approval", "Miami-Dade County Product Approval"]',
  350.00, 10,
  ARRAY['Requires NOA for all products', 'HVHZ compliance mandatory', 'Impact-rated materials required', 'Engineer signature required for >6/12 pitch'],
  'Building Department', '(786) 315-2000'
);

-- Broward
INSERT INTO county_permit_requirements (
  county_id, permit_type, online_submission, permit_portal_url,
  required_documents, base_fee, typical_processing_days,
  special_requirements, department_name, department_phone
) VALUES (
  (SELECT id FROM florida_counties WHERE name = 'Broward'),
  'residential_reroof', true,
  'https://www.broward.org/Building/Permits/Pages/RoofPermit.aspx',
  '["Broward County Uniform Permit Application", "Roof Plan with dimensions", "Product Approval Numbers (NOA)", "Notice of Commencement", "Wind Mitigation Form", "Contractor License"]',
  275.00, 7,
  ARRAY['HVHZ compliance required in coastal areas', 'NOA required for all roofing products'],
  'Environmental Licensing and Building Permitting Division', '(954) 831-4000'
);

-- Hillsborough (Tampa)
INSERT INTO county_permit_requirements (
  county_id, permit_type, online_submission, permit_portal_url,
  required_documents, base_fee, typical_processing_days,
  department_name, department_phone
) VALUES (
  (SELECT id FROM florida_counties WHERE name = 'Hillsborough'),
  'residential_reroof', true,
  'https://www.hillsboroughcounty.org/residents/property-owners-and-renters/building-permits',
  '["Permit Application", "Roof Plan", "Product Specifications", "Notice of Commencement", "Contractor License"]',
  195.00, 5,
  'Construction Services', '(813) 272-5600'
);

-- Lee County (HVHZ after Hurricane Ian)
INSERT INTO county_permit_requirements (
  county_id, permit_type, online_submission, permit_portal_url,
  required_documents, base_fee, typical_processing_days,
  special_requirements, department_name, department_phone
) VALUES (
  (SELECT id FROM florida_counties WHERE name = 'Lee'),
  'residential_reroof', true,
  'https://www.leegov.com/dcd/buildperm',
  '["Permit Application", "Roof Plan with dimensions", "Product Approval Numbers", "Notice of Commencement", "Wind Mitigation Form", "HVHZ Product Approvals"]',
  225.00, 7,
  ARRAY['HVHZ requirements in barrier island areas', 'Enhanced wind requirements post-Ian'],
  'Department of Community Development', '(239) 533-8585'
);

-- Monroe (Florida Keys - strictest wind requirements)
INSERT INTO county_permit_requirements (
  county_id, permit_type, online_submission, permit_portal_url,
  required_documents, base_fee, typical_processing_days,
  special_requirements, department_name, department_phone
) VALUES (
  (SELECT id FROM florida_counties WHERE name = 'Monroe'),
  'residential_reroof', true,
  'https://www.monroecounty-fl.gov/170/Building-Department',
  '["Permit Application", "Roof Plan with dimensions", "Product Approval Numbers (NOA)", "Engineered sealed calculations", "Notice of Commencement", "HVHZ Compliance", "180mph Wind Rating Verification", "Impact-Rated Product Documentation"]',
  400.00, 14,
  ARRAY['180mph wind rating required', 'All products must have HVHZ approval', 'Impact-rated materials mandatory', 'Engineer certification required'],
  'Building Department', '(305) 289-2501'
);