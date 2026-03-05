
-- Add contact_id column to internal_notes
ALTER TABLE internal_notes 
  ADD COLUMN contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE;

-- Make pipeline_entry_id nullable (notes can belong to contact OR pipeline entry)
ALTER TABLE internal_notes 
  ALTER COLUMN pipeline_entry_id DROP NOT NULL;

-- Add check: at least one parent must be set
ALTER TABLE internal_notes 
  ADD CONSTRAINT internal_notes_parent_check 
  CHECK (pipeline_entry_id IS NOT NULL OR contact_id IS NOT NULL);

-- Index for contact-scoped queries
CREATE INDEX idx_internal_notes_contact_id ON internal_notes(contact_id) WHERE contact_id IS NOT NULL;
