-- Add foreign key constraint for contacts.assigned_to -> profiles.id if it doesn't exist
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'contacts_assigned_to_fkey'
    AND table_name = 'contacts'
  ) THEN
    ALTER TABLE contacts
    ADD CONSTRAINT contacts_assigned_to_fkey
    FOREIGN KEY (assigned_to) REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
END $$;