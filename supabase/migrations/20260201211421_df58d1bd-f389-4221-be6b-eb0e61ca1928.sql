-- ============================================================
-- SCOPE INTELLIGENCE SYSTEM - Complete Schema
-- Transforms insurance scope PDFs into searchable evidence vault
-- ============================================================

-- ============================================================
-- PHASE 1: Document Vault
-- ============================================================

-- Raw documents with page-level storage
CREATE TABLE insurance_scope_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  insurance_claim_id UUID REFERENCES insurance_claims(id) ON DELETE SET NULL,
  job_id UUID REFERENCES jobs(id) ON DELETE SET NULL,
  
  -- Document metadata
  document_type TEXT NOT NULL CHECK (document_type IN (
    'estimate', 'supplement', 'denial', 'policy', 'reinspection', 'final_settlement'
  )),
  file_name TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  file_size_bytes INTEGER,
  storage_path TEXT NOT NULL,
  
  -- Carrier/format detection
  carrier_name TEXT,
  carrier_normalized TEXT,
  adjuster_name TEXT,
  claim_number_detected TEXT,
  loss_date_detected DATE,
  format_family TEXT CHECK (format_family IN ('xactimate', 'symbility', 'corelogic', 'generic')),
  
  -- Parsing status
  parse_status TEXT DEFAULT 'pending' CHECK (parse_status IN (
    'pending', 'extracting', 'parsing', 'mapping', 'complete', 'failed', 'needs_review'
  )),
  parse_started_at TIMESTAMPTZ,
  parse_completed_at TIMESTAMPTZ,
  parse_error TEXT,
  parser_version TEXT,
  
  -- Extracted content
  raw_text_content TEXT,
  raw_json_output JSONB,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES profiles(id),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Page-level storage for evidence highlighting
CREATE TABLE insurance_scope_document_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES insurance_scope_documents(id) ON DELETE CASCADE,
  page_number INTEGER NOT NULL,
  page_image_path TEXT,
  page_text_content TEXT,
  page_tables_json JSONB,
  
  UNIQUE(document_id, page_number)
);

-- ============================================================
-- PHASE 2: Canonical Taxonomy (must be before line items)
-- ============================================================

-- Canonical line item definitions (cross-carrier)
CREATE TABLE insurance_canonical_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  canonical_key TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  category TEXT NOT NULL,
  subcategory TEXT,
  
  xactimate_selector TEXT,
  
  standard_unit TEXT NOT NULL,
  alternate_units TEXT[],
  
  description_patterns TEXT[],
  code_patterns TEXT[],
  
  is_labor BOOLEAN DEFAULT FALSE,
  is_material BOOLEAN DEFAULT FALSE,
  is_overhead BOOLEAN DEFAULT FALSE,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- PHASE 3: Structured Scope Data
-- ============================================================

-- Header-level scope data (totals, metadata)
CREATE TABLE insurance_scope_headers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES insurance_scope_documents(id) ON DELETE CASCADE,
  
  -- Totals (ACV/RCV/Depreciation model)
  total_rcv DECIMAL(12,2),
  total_acv DECIMAL(12,2),
  total_depreciation DECIMAL(12,2),
  recoverable_depreciation DECIMAL(12,2),
  non_recoverable_depreciation DECIMAL(12,2),
  deductible DECIMAL(12,2),
  tax_amount DECIMAL(12,2),
  overhead_amount DECIMAL(12,2),
  profit_amount DECIMAL(12,2),
  total_net_claim DECIMAL(12,2),
  
  supplement_count INTEGER DEFAULT 0,
  total_supplement_amount DECIMAL(12,2),
  
  price_list_name TEXT,
  price_list_region TEXT,
  price_list_effective_date DATE,
  
  estimate_date DATE,
  property_address TEXT,
  property_city TEXT,
  property_state TEXT,
  property_zip TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Individual line items
CREATE TABLE insurance_scope_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  header_id UUID NOT NULL REFERENCES insurance_scope_headers(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES insurance_scope_documents(id) ON DELETE CASCADE,
  
  raw_code TEXT,
  raw_description TEXT NOT NULL,
  raw_category TEXT,
  
  quantity DECIMAL(12,4),
  unit TEXT,
  unit_price DECIMAL(12,4),
  total_rcv DECIMAL(12,2),
  
  depreciation_percent DECIMAL(5,2),
  depreciation_amount DECIMAL(12,2),
  total_acv DECIMAL(12,2),
  age_years DECIMAL(5,2),
  life_years DECIMAL(5,2),
  
  is_taxable BOOLEAN,
  tax_amount DECIMAL(12,2),
  
  labor_amount DECIMAL(12,2),
  material_amount DECIMAL(12,2),
  
  canonical_item_id UUID REFERENCES insurance_canonical_items(id),
  mapping_confidence DECIMAL(5,4),
  mapping_method TEXT CHECK (mapping_method IN ('exact', 'fuzzy', 'ai', 'manual')),
  
  line_order INTEGER,
  section_name TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Mapping table: raw line items → canonical items
CREATE TABLE insurance_line_item_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  carrier_normalized TEXT NOT NULL,
  raw_code TEXT,
  raw_description TEXT NOT NULL,
  
  canonical_item_id UUID NOT NULL REFERENCES insurance_canonical_items(id),
  
  confidence DECIMAL(5,4) NOT NULL,
  mapping_method TEXT NOT NULL CHECK (mapping_method IN ('exact', 'fuzzy', 'ai', 'manual')),
  
  verified_by UUID REFERENCES profiles(id),
  verified_at TIMESTAMPTZ,
  usage_count INTEGER DEFAULT 1,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(carrier_normalized, raw_code, raw_description)
);

-- Evidence binding: where each value came from
CREATE TABLE insurance_scope_line_item_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  line_item_id UUID NOT NULL REFERENCES insurance_scope_line_items(id) ON DELETE CASCADE,
  document_id UUID NOT NULL REFERENCES insurance_scope_documents(id) ON DELETE CASCADE,
  
  page_number INTEGER NOT NULL,
  table_index INTEGER,
  row_index INTEGER,
  
  bbox_x DECIMAL(8,4),
  bbox_y DECIMAL(8,4),
  bbox_width DECIMAL(8,4),
  bbox_height DECIMAL(8,4),
  
  snippet_text TEXT NOT NULL,
  snippet_hash TEXT NOT NULL,
  
  field_type TEXT NOT NULL CHECK (field_type IN (
    'code', 'description', 'quantity', 'unit', 'unit_price', 'total', 'depreciation'
  )),
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- PHASE 4: Intelligence Network
-- ============================================================

-- Generated evidence packets for supplements
CREATE TABLE insurance_supplement_packets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  
  job_id UUID REFERENCES jobs(id),
  insurance_claim_id UUID REFERENCES insurance_claims(id),
  
  title TEXT NOT NULL,
  items_json JSONB NOT NULL,
  prior_examples_json JSONB,
  
  pdf_url TEXT,
  html_content TEXT,
  
  status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'generated', 'sent', 'archived')),
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Anonymized contributions for cross-company learning
CREATE TABLE insurance_network_contributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  
  contributor_hash TEXT NOT NULL,
  consent_given_at TIMESTAMPTZ NOT NULL,
  consent_version TEXT,
  
  carrier_normalized TEXT NOT NULL,
  state_code TEXT,
  loss_year INTEGER,
  canonical_item_id UUID NOT NULL REFERENCES insurance_canonical_items(id),
  
  quantity_bucket TEXT,
  unit_price_bucket TEXT,
  
  was_paid BOOLEAN,
  was_disputed BOOLEAN,
  was_supplemented BOOLEAN,
  
  pitch_category TEXT CHECK (pitch_category IN ('walkable', 'steep', 'very_steep')),
  story_count INTEGER,
  is_tearoff BOOLEAN,
  
  redacted_snippet TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Dispute tracking per job
CREATE TABLE insurance_scope_disputes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  job_id UUID REFERENCES jobs(id),
  insurance_claim_id UUID REFERENCES insurance_claims(id),
  
  canonical_item_id UUID REFERENCES insurance_canonical_items(id),
  disputed_line_item_id UUID REFERENCES insurance_scope_line_items(id),
  
  dispute_reason TEXT NOT NULL,
  requested_amount DECIMAL(12,2),
  carrier_response TEXT,
  
  status TEXT DEFAULT 'pending' CHECK (status IN (
    'pending', 'submitted', 'approved', 'denied', 'partial', 'withdrawn'
  )),
  approved_amount DECIMAL(12,2),
  
  evidence_packet_id UUID REFERENCES insurance_supplement_packets(id),
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- INDEXES for performance
-- ============================================================

CREATE INDEX idx_scope_docs_tenant ON insurance_scope_documents(tenant_id);
CREATE INDEX idx_scope_docs_claim ON insurance_scope_documents(insurance_claim_id);
CREATE INDEX idx_scope_docs_job ON insurance_scope_documents(job_id);
CREATE INDEX idx_scope_docs_status ON insurance_scope_documents(parse_status);
CREATE INDEX idx_scope_docs_carrier ON insurance_scope_documents(carrier_normalized);

CREATE INDEX idx_scope_pages_document ON insurance_scope_document_pages(document_id);

CREATE INDEX idx_scope_headers_document ON insurance_scope_headers(document_id);

CREATE INDEX idx_scope_items_header ON insurance_scope_line_items(header_id);
CREATE INDEX idx_scope_items_document ON insurance_scope_line_items(document_id);
CREATE INDEX idx_scope_items_canonical ON insurance_scope_line_items(canonical_item_id);

CREATE INDEX idx_canonical_items_key ON insurance_canonical_items(canonical_key);
CREATE INDEX idx_canonical_items_category ON insurance_canonical_items(category);

CREATE INDEX idx_item_mappings_carrier ON insurance_line_item_mappings(carrier_normalized);
CREATE INDEX idx_item_mappings_canonical ON insurance_line_item_mappings(canonical_item_id);

CREATE INDEX idx_evidence_line_item ON insurance_scope_line_item_evidence(line_item_id);
CREATE INDEX idx_evidence_document ON insurance_scope_line_item_evidence(document_id);

CREATE INDEX idx_network_carrier_state ON insurance_network_contributions(carrier_normalized, state_code);
CREATE INDEX idx_network_canonical ON insurance_network_contributions(canonical_item_id);

CREATE INDEX idx_disputes_tenant ON insurance_scope_disputes(tenant_id);
CREATE INDEX idx_disputes_job ON insurance_scope_disputes(job_id);

CREATE INDEX idx_packets_tenant ON insurance_supplement_packets(tenant_id);

-- ============================================================
-- RLS POLICIES
-- ============================================================

ALTER TABLE insurance_scope_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE insurance_scope_document_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE insurance_scope_headers ENABLE ROW LEVEL SECURITY;
ALTER TABLE insurance_scope_line_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE insurance_canonical_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE insurance_line_item_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE insurance_scope_line_item_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE insurance_supplement_packets ENABLE ROW LEVEL SECURITY;
ALTER TABLE insurance_network_contributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE insurance_scope_disputes ENABLE ROW LEVEL SECURITY;

-- Tenant isolation for documents
CREATE POLICY "tenant_isolation_scope_docs" ON insurance_scope_documents
  FOR ALL USING (tenant_id = get_user_tenant_id());

-- Pages inherit from parent document
CREATE POLICY "pages_via_document" ON insurance_scope_document_pages
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM insurance_scope_documents d 
      WHERE d.id = document_id AND d.tenant_id = get_user_tenant_id()
    )
  );

-- Headers inherit from parent document
CREATE POLICY "headers_via_document" ON insurance_scope_headers
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM insurance_scope_documents d 
      WHERE d.id = document_id AND d.tenant_id = get_user_tenant_id()
    )
  );

-- Line items inherit from parent document
CREATE POLICY "items_via_document" ON insurance_scope_line_items
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM insurance_scope_documents d 
      WHERE d.id = document_id AND d.tenant_id = get_user_tenant_id()
    )
  );

-- Evidence inherits from parent document
CREATE POLICY "evidence_via_document" ON insurance_scope_line_item_evidence
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM insurance_scope_documents d 
      WHERE d.id = document_id AND d.tenant_id = get_user_tenant_id()
    )
  );

-- Canonical items are global read, admin write
CREATE POLICY "canonical_items_read_all" ON insurance_canonical_items
  FOR SELECT USING (true);

CREATE POLICY "canonical_items_admin_write" ON insurance_canonical_items
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM user_roles ur 
      WHERE ur.user_id = auth.uid() AND ur.role IN ('master', 'corporate')
    )
  );

-- Line item mappings are global read, users can insert
CREATE POLICY "mappings_read_all" ON insurance_line_item_mappings
  FOR SELECT USING (true);

CREATE POLICY "mappings_insert_auth" ON insurance_line_item_mappings
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "mappings_update_verified" ON insurance_line_item_mappings
  FOR UPDATE USING (
    verified_by IS NULL OR verified_by = auth.uid()
  );

-- Supplement packets tenant isolated
CREATE POLICY "packets_tenant_isolation" ON insurance_supplement_packets
  FOR ALL USING (tenant_id = get_user_tenant_id());

-- Network contributions: all can read, insert own (anonymized)
CREATE POLICY "network_read_all" ON insurance_network_contributions
  FOR SELECT USING (true);

CREATE POLICY "network_insert_own" ON insurance_network_contributions
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- Disputes tenant isolated
CREATE POLICY "disputes_tenant_isolation" ON insurance_scope_disputes
  FOR ALL USING (tenant_id = get_user_tenant_id());

-- ============================================================
-- SEED DATA: Initial canonical roofing items (~50 core items)
-- ============================================================

INSERT INTO insurance_canonical_items (canonical_key, display_name, category, subcategory, xactimate_selector, standard_unit, alternate_units, description_patterns, code_patterns, is_material, is_labor) VALUES
-- Shingles - Removal
('ROOF_SHINGLE_REMOVE', 'Remove Roofing - Composition shingles', 'Roofing', 'Tear-off', 'RFG RDCK', 'SQ', ARRAY['SF'], ARRAY['(?i)remove.*shingle', '(?i)tear.*off.*roof', '(?i)r&r.*shingle'], ARRAY['RFG%RDCK%', 'RFGRDCK'], TRUE, TRUE),
('ROOF_SHINGLE_REMOVE_ADDL_LAYER', 'Remove Additional Layer of Shingles', 'Roofing', 'Tear-off', 'RFG RDCKL', 'SQ', ARRAY['SF'], ARRAY['(?i)additional.*layer', '(?i)2nd.*layer'], ARRAY['RFG%RDCKL%'], TRUE, TRUE),

-- Shingles - Installation
('ROOF_SHINGLE_3TAB', '3-Tab Shingles - 25 year', 'Roofing', 'Shingles', 'RFG SHNG', 'SQ', ARRAY['SF'], ARRAY['(?i)3.*tab', '(?i)three.*tab', '(?i)25.*year.*shingle'], ARRAY['RFG%SHNG%'], TRUE, FALSE),
('ROOF_SHINGLE_ARCH_25', 'Architectural Shingles - 25 year', 'Roofing', 'Shingles', 'RFG SHNGD25', 'SQ', ARRAY['SF'], ARRAY['(?i)architect.*25', '(?i)dimensional.*25'], ARRAY['RFG%SHNGD%25%'], TRUE, FALSE),
('ROOF_SHINGLE_ARCH_30', 'Architectural Shingles - 30 year', 'Roofing', 'Shingles', 'RFG SHNGD30', 'SQ', ARRAY['SF'], ARRAY['(?i)architect.*30', '(?i)dimensional.*30', '(?i)landmark'], ARRAY['RFG%SHNGD%30%'], TRUE, FALSE),
('ROOF_SHINGLE_ARCH_50', 'Architectural Shingles - 50 year (Lifetime)', 'Roofing', 'Shingles', 'RFG SHNGD50', 'SQ', ARRAY['SF'], ARRAY['(?i)architect.*50', '(?i)lifetime', '(?i)duration'], ARRAY['RFG%SHNGD%50%'], TRUE, FALSE),
('ROOF_SHINGLE_DESIGNER', 'Designer/Premium Shingles', 'Roofing', 'Shingles', 'RFG SHNGPREM', 'SQ', ARRAY['SF'], ARRAY['(?i)designer', '(?i)premium.*shingle', '(?i)grand.*manor'], ARRAY['RFG%PREM%'], TRUE, FALSE),

-- Underlayment
('ROOF_FELT_15', '15# Felt Underlayment', 'Roofing', 'Underlayment', 'RFG FELT15', 'SQ', ARRAY['SF'], ARRAY['(?i)15.*felt', '(?i)15#.*felt', '(?i)15.*lb.*felt'], ARRAY['RFG%FELT%15%'], TRUE, FALSE),
('ROOF_FELT_30', '30# Felt Underlayment', 'Roofing', 'Underlayment', 'RFG FELT30', 'SQ', ARRAY['SF'], ARRAY['(?i)30.*felt', '(?i)30#.*felt', '(?i)30.*lb.*felt'], ARRAY['RFG%FELT%30%'], TRUE, FALSE),
('ROOF_SYNTHETIC_UNDERLAY', 'Synthetic Underlayment', 'Roofing', 'Underlayment', 'RFG SYNTH', 'SQ', ARRAY['SF'], ARRAY['(?i)synthetic.*underlay', '(?i)titanium', '(?i)deck.*armor'], ARRAY['RFG%SYNTH%'], TRUE, FALSE),
('ROOF_ICE_WATER_SHIELD', 'Ice & Water Shield', 'Roofing', 'Underlayment', 'RFG ICEW', 'SQ', ARRAY['SF', 'LF'], ARRAY['(?i)ice.*water', '(?i)weatherwatch', '(?i)storm.*guard'], ARRAY['RFG%ICEW%', 'RFG%IW%'], TRUE, FALSE),

-- Flashing & Trim
('ROOF_DRIP_EDGE', 'Drip Edge - Aluminum', 'Roofing', 'Flashing', 'RFG DRPE', 'LF', NULL, ARRAY['(?i)drip.*edge', '(?i)eave.*metal'], ARRAY['RFG%DRPE%', 'RFG%DRIP%'], TRUE, FALSE),
('ROOF_DRIP_EDGE_GALV', 'Drip Edge - Galvanized', 'Roofing', 'Flashing', 'RFG DRPEG', 'LF', NULL, ARRAY['(?i)galv.*drip'], ARRAY['RFG%DRPEG%'], TRUE, FALSE),
('ROOF_RAKE_EDGE', 'Rake Edge Metal', 'Roofing', 'Flashing', 'RFG RAKE', 'LF', NULL, ARRAY['(?i)rake.*edge', '(?i)gable.*edge'], ARRAY['RFG%RAKE%'], TRUE, FALSE),
('ROOF_STEP_FLASHING', 'Step Flashing', 'Roofing', 'Flashing', 'RFG FLSH', 'EA', ARRAY['LF'], ARRAY['(?i)step.*flash'], ARRAY['RFG%FLSH%STEP%'], TRUE, FALSE),
('ROOF_VALLEY_METAL', 'Valley Metal - W-Type', 'Roofing', 'Flashing', 'RFG VALY', 'LF', NULL, ARRAY['(?i)valley.*metal', '(?i)w.*valley'], ARRAY['RFG%VALY%'], TRUE, FALSE),
('ROOF_PIPE_BOOT', 'Pipe Jack/Boot', 'Roofing', 'Flashing', 'RFG BOOT', 'EA', NULL, ARRAY['(?i)pipe.*boot', '(?i)pipe.*jack', '(?i)plumbing.*vent'], ARRAY['RFG%BOOT%', 'RFG%JACK%'], TRUE, FALSE),
('ROOF_CHIMNEY_FLASHING', 'Chimney Flashing', 'Roofing', 'Flashing', 'RFG CHIM', 'LF', NULL, ARRAY['(?i)chimney.*flash'], ARRAY['RFG%CHIM%'], TRUE, TRUE),

-- Ridge & Starters
('ROOF_STARTER_STRIP', 'Starter Strip Shingles', 'Roofing', 'Accessories', 'RFG STRT', 'LF', NULL, ARRAY['(?i)starter.*strip', '(?i)starter.*shingle'], ARRAY['RFG%STRT%'], TRUE, FALSE),
('ROOF_RIDGE_CAP', 'Ridge Cap Shingles', 'Roofing', 'Accessories', 'RFG RDGC', 'LF', NULL, ARRAY['(?i)ridge.*cap', '(?i)hip.*cap', '(?i)cap.*shingle'], ARRAY['RFG%RDGC%', 'RFG%CAP%'], TRUE, FALSE),
('ROOF_HIP_CAP', 'Hip Cap Shingles', 'Roofing', 'Accessories', 'RFG HIPC', 'LF', NULL, ARRAY['(?i)hip.*cap'], ARRAY['RFG%HIPC%'], TRUE, FALSE),

-- Ventilation
('ROOF_RIDGE_VENT', 'Ridge Vent', 'Roofing', 'Ventilation', 'RFG RDGV', 'LF', NULL, ARRAY['(?i)ridge.*vent', '(?i)cobra.*vent'], ARRAY['RFG%RDGV%'], TRUE, FALSE),
('ROOF_BOX_VENT', 'Box Vent/Roof Louver', 'Roofing', 'Ventilation', 'RFG VENT', 'EA', NULL, ARRAY['(?i)box.*vent', '(?i)roof.*louver', '(?i)750.*vent'], ARRAY['RFG%VENT%'], TRUE, FALSE),
('ROOF_TURBINE_VENT', 'Turbine Vent', 'Roofing', 'Ventilation', 'RFG TURB', 'EA', NULL, ARRAY['(?i)turbine.*vent', '(?i)whirlybird'], ARRAY['RFG%TURB%'], TRUE, FALSE),
('ROOF_POWER_VENT', 'Power Attic Vent', 'Roofing', 'Ventilation', 'RFG PWRV', 'EA', NULL, ARRAY['(?i)power.*vent', '(?i)attic.*fan'], ARRAY['RFG%PWRV%'], TRUE, FALSE),
('ROOF_SOFFIT_VENT', 'Soffit Vent', 'Roofing', 'Ventilation', 'RFG SOFT', 'EA', ARRAY['LF'], ARRAY['(?i)soffit.*vent'], ARRAY['RFG%SOFT%'], TRUE, FALSE),

-- Decking
('ROOF_DECKING_OSB', 'OSB Roof Decking - 7/16"', 'Roofing', 'Decking', 'RFG DECK', 'SF', NULL, ARRAY['(?i)osb.*deck', '(?i)7/16.*osb', '(?i)roof.*sheathing'], ARRAY['RFG%DECK%', 'RFG%OSB%'], TRUE, FALSE),
('ROOF_DECKING_PLYWOOD', 'Plywood Roof Decking - 1/2"', 'Roofing', 'Decking', 'RFG DECKP', 'SF', NULL, ARRAY['(?i)plywood.*deck', '(?i)1/2.*plywood'], ARRAY['RFG%DECKP%', 'RFG%PLY%'], TRUE, FALSE),
('ROOF_FASCIA_BOARD', 'Fascia Board', 'Roofing', 'Decking', 'RFG FASC', 'LF', NULL, ARRAY['(?i)fascia'], ARRAY['RFG%FASC%'], TRUE, FALSE),

-- Charges
('ROOF_STEEP_CHARGE', 'Steep Pitch Charge (7/12 - 9/12)', 'Roofing', 'Charges', 'RFG STEE', 'SQ', NULL, ARRAY['(?i)steep.*charge', '(?i)steep.*pitch', '(?i)7/12.*9/12'], ARRAY['RFG%STEE%'], FALSE, TRUE),
('ROOF_VERY_STEEP_CHARGE', 'Very Steep Pitch Charge (10/12+)', 'Roofing', 'Charges', 'RFG VSTE', 'SQ', NULL, ARRAY['(?i)very.*steep', '(?i)10/12', '(?i)extreme.*pitch'], ARRAY['RFG%VSTE%'], FALSE, TRUE),
('ROOF_HIGH_CHARGE', 'High Roof Charge (2+ story)', 'Roofing', 'Charges', 'RFG HIGH', 'SQ', NULL, ARRAY['(?i)high.*charge', '(?i)2.*story', '(?i)height.*charge'], ARRAY['RFG%HIGH%'], FALSE, TRUE),
('ROOF_CUT_COMPLEX', 'Cut-up/Complex Roof Charge', 'Roofing', 'Charges', 'RFG CMPLX', 'SQ', NULL, ARRAY['(?i)cut.*up', '(?i)complex.*roof'], ARRAY['RFG%CMPLX%'], FALSE, TRUE),

-- Gutters
('GUTTER_SEAMLESS_5', '5" Seamless Aluminum Gutter', 'Gutters', 'Gutter', 'GTR ALUM5', 'LF', NULL, ARRAY['(?i)5.*gutter', '(?i)seamless.*gutter', '(?i)aluminum.*gutter'], ARRAY['GTR%ALUM%5%'], TRUE, FALSE),
('GUTTER_SEAMLESS_6', '6" Seamless Aluminum Gutter', 'Gutters', 'Gutter', 'GTR ALUM6', 'LF', NULL, ARRAY['(?i)6.*gutter', '(?i)oversized.*gutter'], ARRAY['GTR%ALUM%6%'], TRUE, FALSE),
('GUTTER_DOWNSPOUT', 'Downspout - Aluminum', 'Gutters', 'Downspout', 'GTR DSPW', 'LF', NULL, ARRAY['(?i)downspout', '(?i)down.*spout'], ARRAY['GTR%DSPW%'], TRUE, FALSE),
('GUTTER_ELBOW', 'Downspout Elbow', 'Gutters', 'Downspout', 'GTR ELBO', 'EA', NULL, ARRAY['(?i)elbow', '(?i)downspout.*elbow'], ARRAY['GTR%ELBO%'], TRUE, FALSE),
('GUTTER_GUARD', 'Gutter Guard/Screen', 'Gutters', 'Accessories', 'GTR GARD', 'LF', NULL, ARRAY['(?i)gutter.*guard', '(?i)gutter.*screen', '(?i)leaf.*guard'], ARRAY['GTR%GARD%'], TRUE, FALSE),

-- Siding (basic)
('SIDING_VINYL_REMOVE', 'Remove Vinyl Siding', 'Siding', 'Tear-off', 'SDL RVIN', 'SF', NULL, ARRAY['(?i)remove.*vinyl.*siding'], ARRAY['SDL%RVIN%'], FALSE, TRUE),
('SIDING_VINYL_INSTALL', 'Vinyl Siding - Standard', 'Siding', 'Installation', 'SDL VIN', 'SF', NULL, ARRAY['(?i)vinyl.*siding'], ARRAY['SDL%VIN%'], TRUE, TRUE),
('SIDING_HARDIE_INSTALL', 'Fiber Cement Siding (HardiePlank)', 'Siding', 'Installation', 'SDL FCEM', 'SF', NULL, ARRAY['(?i)hardie', '(?i)fiber.*cement', '(?i)hardy.*plank'], ARRAY['SDL%FCEM%', 'SDL%HARD%'], TRUE, TRUE),

-- Solar (D&R)
('SOLAR_DETACH_RESET', 'Detach & Reset Solar Panels', 'Solar', 'D&R', 'ELC SOLR', 'EA', NULL, ARRAY['(?i)solar.*detach', '(?i)d&r.*solar', '(?i)remove.*reset.*solar'], ARRAY['ELC%SOLR%'], FALSE, TRUE),

-- Dumpster/Haul
('HAUL_DUMPSTER', 'Dumpster - Roofing Debris', 'General', 'Hauling', 'GEN DUMP', 'EA', NULL, ARRAY['(?i)dumpster', '(?i)haul.*off', '(?i)debris.*removal'], ARRAY['GEN%DUMP%', 'GEN%HAUL%'], FALSE, TRUE),

-- Permits
('PERMIT_ROOFING', 'Roofing Permit', 'General', 'Permits', 'GEN PRMT', 'EA', NULL, ARRAY['(?i)permit', '(?i)building.*permit'], ARRAY['GEN%PRMT%'], FALSE, FALSE);

-- ============================================================
-- UPDATE TRIGGER for updated_at
-- ============================================================

CREATE OR REPLACE FUNCTION update_scope_intelligence_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_insurance_scope_documents_updated_at
  BEFORE UPDATE ON insurance_scope_documents
  FOR EACH ROW EXECUTE FUNCTION update_scope_intelligence_updated_at();

CREATE TRIGGER update_insurance_scope_headers_updated_at
  BEFORE UPDATE ON insurance_scope_headers
  FOR EACH ROW EXECUTE FUNCTION update_scope_intelligence_updated_at();

CREATE TRIGGER update_insurance_scope_line_items_updated_at
  BEFORE UPDATE ON insurance_scope_line_items
  FOR EACH ROW EXECUTE FUNCTION update_scope_intelligence_updated_at();

CREATE TRIGGER update_insurance_line_item_mappings_updated_at
  BEFORE UPDATE ON insurance_line_item_mappings
  FOR EACH ROW EXECUTE FUNCTION update_scope_intelligence_updated_at();

CREATE TRIGGER update_insurance_supplement_packets_updated_at
  BEFORE UPDATE ON insurance_supplement_packets
  FOR EACH ROW EXECUTE FUNCTION update_scope_intelligence_updated_at();

CREATE TRIGGER update_insurance_scope_disputes_updated_at
  BEFORE UPDATE ON insurance_scope_disputes
  FOR EACH ROW EXECUTE FUNCTION update_scope_intelligence_updated_at();

CREATE TRIGGER update_insurance_canonical_items_updated_at
  BEFORE UPDATE ON insurance_canonical_items
  FOR EACH ROW EXECUTE FUNCTION update_scope_intelligence_updated_at();