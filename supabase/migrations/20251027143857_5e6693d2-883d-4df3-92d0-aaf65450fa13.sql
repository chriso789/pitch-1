-- Add DEFAULT values for tenant_id columns to use get_user_tenant_id()

-- Update change_orders table
ALTER TABLE change_orders 
  ALTER COLUMN tenant_id SET DEFAULT get_user_tenant_id();

-- Update change_order_line_items table  
-- (doesn't have tenant_id, so no change needed)

-- Update time_entries table
ALTER TABLE time_entries 
  ALTER COLUMN tenant_id SET DEFAULT get_user_tenant_id();

-- Update labor_cost_tracking table
ALTER TABLE labor_cost_tracking 
  ALTER COLUMN tenant_id SET DEFAULT get_user_tenant_id();