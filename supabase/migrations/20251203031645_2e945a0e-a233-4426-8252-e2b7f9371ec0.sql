-- Patent tracking table for competitive research
CREATE TABLE industry_patents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patent_number TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  assignee TEXT,
  filing_date DATE,
  grant_date DATE,
  expiration_date DATE,
  status TEXT CHECK (status IN ('active', 'expired', 'pending', 'abandoned')),
  country TEXT DEFAULT 'US',
  category TEXT,
  abstract TEXT,
  relevance_to_pitch TEXT,
  risk_level TEXT CHECK (risk_level IN ('high', 'medium', 'low', 'none')),
  notes TEXT,
  pdf_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Our own patent applications/ideas
CREATE TABLE pitch_patent_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  working_title TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  key_claims TEXT[],
  status TEXT DEFAULT 'idea' CHECK (status IN ('idea', 'researching', 'drafting', 'filed', 'pending', 'granted', 'rejected')),
  filed_date DATE,
  application_number TEXT,
  attorney_notes TEXT,
  priority_level TEXT CHECK (priority_level IN ('critical', 'high', 'medium', 'low')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS policies for admin-only access
ALTER TABLE industry_patents ENABLE ROW LEVEL SECURITY;
ALTER TABLE pitch_patent_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Master users can manage patents"
ON industry_patents FOR ALL
USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'master'));

CREATE POLICY "Master users can manage applications"
ON pitch_patent_applications FOR ALL
USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'master'));

-- Seed competitor patent data
INSERT INTO industry_patents (patent_number, title, assignee, filing_date, grant_date, status, category, abstract, relevance_to_pitch, risk_level) VALUES
-- EagleView Patents
('US8,078,436', 'Aerial roof estimation system and method', 'EagleView Technologies', '2008-06-03', '2011-12-13', 'active', 'roof_measurement', 'System for generating roof reports from aerial imagery using computer vision', 'Core measurement technology - need alternative approach', 'high'),
('US8,145,578', 'Automated extraction of roof geometry', 'EagleView Technologies', '2009-07-17', '2012-03-27', 'active', 'roof_measurement', 'Methods for automated detection and measurement of roof structures from aerial images', 'Automated geometry extraction - our AI approach differs', 'medium'),
('US8,170,840', 'Pitch determination system from aerial imagery', 'EagleView Technologies', '2010-05-21', '2012-05-01', 'active', 'roof_measurement', 'System for determining roof pitch from oblique aerial imagery', 'Pitch calculation method - we use different algorithm', 'medium'),
('US8,825,454', 'Roof condition assessment from aerial images', 'EagleView Technologies', '2012-03-15', '2014-09-02', 'active', 'roof_measurement', 'Automated assessment of roof condition including damage detection', 'Condition assessment feature potential overlap', 'medium'),
('US9,135,737', 'Integration of aerial imagery with customer data', 'EagleView Technologies', '2013-04-22', '2015-09-15', 'active', 'crm_integration', 'Methods for integrating aerial measurement data with CRM systems', 'CRM integration approach - need to differentiate', 'low'),
('US10,013,456', 'Machine learning for roof structure identification', 'EagleView Technologies', '2016-08-10', '2018-07-03', 'active', 'ai_measurement', 'ML-based identification of roof structures and features', 'AI measurement overlap - our model architecture differs', 'high'),

-- Hover Patents
('US9,679,227', '3D model generation from 2D imagery', 'Hover Inc.', '2014-02-28', '2017-06-13', 'active', '3d_modeling', 'System for generating 3D property models from smartphone photos', '3D modeling feature - different input method', 'medium'),
('US10,186,051', 'Property measurement via mobile device imagery', 'Hover Inc.', '2016-05-12', '2019-01-22', 'active', 'mobile_measurement', 'Methods for measuring properties using smartphone camera and sensors', 'Mobile measurement approach consideration', 'low'),
('US10,504,276', 'Automated quote generation from 3D models', 'Hover Inc.', '2017-11-03', '2019-12-10', 'active', 'estimating', 'System for generating contractor quotes from property measurements', 'Quote automation - our template system differs', 'low'),

-- DocuSign Patents
('US8,949,708', 'Electronic signature workflow management', 'DocuSign Inc.', '2012-09-14', '2015-02-03', 'active', 'esignature', 'Methods for managing electronic signature workflows', 'E-signature workflow - using standard protocols', 'low'),
('US9,230,130', 'Mobile document signing with biometric verification', 'DocuSign Inc.', '2013-06-21', '2016-01-05', 'active', 'esignature', 'Mobile signature capture with identity verification', 'Mobile signing - different implementation', 'none'),

-- Estimating Edge Patents  
('US10,657,529', 'Material estimation from roof measurements', 'Estimating Edge LLC', '2018-03-15', '2020-05-19', 'active', 'material_calculation', 'Automated material takeoff calculations from roof measurement data', 'Material calculation algorithm - common industry formulas', 'low'),

-- General Construction Tech Patents
('US9,454,853', 'Field service management with GPS tracking', 'ServiceTitan Inc.', '2014-11-05', '2016-09-27', 'active', 'field_management', 'GPS-based field technician management and routing', 'Territory management feature consideration', 'low'),
('US10,332,162', 'Automated insurance claim processing for property damage', 'Xactware Solutions', '2017-02-08', '2019-06-25', 'active', 'insurance', 'System for processing insurance claims from property measurements', 'Insurance workflow integration', 'none'),
('US8,635,554', 'Interactive territory mapping for sales teams', 'Salesforce.com', '2011-04-12', '2014-01-21', 'active', 'territory_mapping', 'Visual territory assignment and management system', 'Territory mapping - common GIS techniques', 'none'),
('US9,818,155', 'Predictive dialer with CRM integration', 'Five9 Inc.', '2015-08-20', '2017-11-14', 'active', 'power_dialer', 'Cloud-based predictive dialing with customer data integration', 'Power dialer integration approach', 'none');

-- Seed our patent application ideas
INSERT INTO pitch_patent_applications (working_title, category, description, key_claims, status, priority_level) VALUES
('AI-Powered Multi-Source Roof Measurement Synthesis', 'ai_measurement', 'Novel method combining satellite imagery, Google Solar API, and user input for roof measurement with confidence scoring and self-correction', ARRAY['Multi-source data fusion for roof geometry', 'Confidence-weighted measurement averaging', 'Real-time accuracy validation system', 'Self-correcting measurement algorithm'], 'researching', 'critical'),
('Integrated Measurement-to-Estimate Workflow Automation', 'workflow_automation', 'System for seamless transition from roof measurements to material calculations to estimate generation with smart template population', ARRAY['Smart tag system for dynamic template population', 'Measurement-driven material quantity calculation', 'Automated waste factor optimization', 'Multi-tier pricing option generation'], 'idea', 'high'),
('Gamified Field Canvassing with Real-Time Competition', 'gamification', 'Platform for competitive canvassing with GPS verification, real-time leaderboards, achievement systems, and integrated reward distribution', ARRAY['GPS-verified activity logging', 'Real-time competitive scoring algorithms', 'Integrated reward distribution via payment rails', 'Achievement-based gamification engine'], 'idea', 'high'),
('Voice-Activated CRM Operations via AI Agent', 'ai_assistant', 'Natural language interface for CRM operations including contact creation, task scheduling, and data retrieval via voice commands', ARRAY['Voice-to-CRM-action conversion', 'Context-aware command interpretation', 'Multi-turn conversational CRM interface', 'Hands-free field operation mode'], 'idea', 'medium'),
('Unified Construction Sales Pipeline with Multi-Company Isolation', 'multi_tenant', 'Architecture for multi-tenant CRM with company switching, role-based access control, and complete data isolation', ARRAY['Dynamic tenant context switching', 'Row-level security with company isolation', 'Cross-company user access management', 'Unified pipeline across company boundaries'], 'idea', 'medium');

-- Create indexes for performance
CREATE INDEX idx_industry_patents_category ON industry_patents(category);
CREATE INDEX idx_industry_patents_assignee ON industry_patents(assignee);
CREATE INDEX idx_industry_patents_status ON industry_patents(status);
CREATE INDEX idx_pitch_applications_status ON pitch_patent_applications(status);
CREATE INDEX idx_pitch_applications_priority ON pitch_patent_applications(priority_level);