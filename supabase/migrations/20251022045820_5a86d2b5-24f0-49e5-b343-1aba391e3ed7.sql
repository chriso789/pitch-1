-- Create RLS policies for calls table
-- Enable RLS on calls table
ALTER TABLE calls ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view calls from their tenant
CREATE POLICY "Users can view their tenant's calls"
ON calls
FOR SELECT
USING (
  tenant_id IN (
    SELECT tenant_id FROM profiles WHERE id = auth.uid()
  )
);

-- Policy: Users can insert calls for their tenant
CREATE POLICY "Users can create calls for their tenant"
ON calls
FOR INSERT
WITH CHECK (
  tenant_id IN (
    SELECT tenant_id FROM profiles WHERE id = auth.uid()
  )
);

-- Policy: Users can update calls from their tenant
CREATE POLICY "Users can update their tenant's calls"
ON calls
FOR UPDATE
USING (
  tenant_id IN (
    SELECT tenant_id FROM profiles WHERE id = auth.uid()
  )
);

-- Policy: Users can delete calls from their tenant (managers only)
CREATE POLICY "Managers can delete their tenant's calls"
ON calls
FOR DELETE
USING (
  tenant_id IN (
    SELECT tenant_id FROM profiles 
    WHERE id = auth.uid() 
    AND role IN ('master', 'corporate', 'office_admin', 'regional_manager')
  )
);