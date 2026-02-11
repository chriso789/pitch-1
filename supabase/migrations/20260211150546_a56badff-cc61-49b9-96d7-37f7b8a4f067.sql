ALTER TABLE ai_answering_config 
ADD COLUMN IF NOT EXISTS qualification_questions JSONB DEFAULT '[
  {"key": "name", "label": "Caller Name", "description": "Full name of the caller", "type": "string", "required": true, "enabled": true},
  {"key": "service_needed", "label": "Service Needed", "description": "What service they need", "type": "string", "required": true, "enabled": true},
  {"key": "callback_number", "label": "Callback Number", "description": "Best phone number to reach them", "type": "string", "required": true, "enabled": true},
  {"key": "address", "label": "Property Address", "description": "Property address where service is needed", "type": "string", "required": false, "enabled": true},
  {"key": "roof_age", "label": "Roof Age", "description": "Approximate age of the roof", "type": "string", "required": false, "enabled": false},
  {"key": "has_insurance_claim", "label": "Insurance Claim", "description": "Whether they have an insurance claim", "type": "boolean", "required": false, "enabled": false},
  {"key": "timeline", "label": "Timeline", "description": "When they want the work done", "type": "string", "required": false, "enabled": false},
  {"key": "budget_range", "label": "Budget Range", "description": "Approximate budget if mentioned", "type": "string", "required": false, "enabled": false}
]';