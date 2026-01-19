-- Add column to link contacts to their source canvassiq property
ALTER TABLE contacts 
ADD COLUMN IF NOT EXISTS canvassiq_property_id UUID REFERENCES canvassiq_properties(id);

-- Create index for fast lookups
CREATE INDEX IF NOT EXISTS idx_contacts_canvassiq_property_id 
ON contacts(canvassiq_property_id) WHERE canvassiq_property_id IS NOT NULL;

-- Add contact_id back-reference to canvassiq_properties if not exists
ALTER TABLE canvassiq_properties
ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES contacts(id);

CREATE INDEX IF NOT EXISTS idx_canvassiq_properties_contact_id
ON canvassiq_properties(contact_id) WHERE contact_id IS NOT NULL;