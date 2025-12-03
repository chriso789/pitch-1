-- Add company overhead rate to tenants table
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS company_overhead_rate DECIMAL(5,2) DEFAULT 15.00;

COMMENT ON COLUMN tenants.company_overhead_rate IS 'Company-level overhead percentage (rent, insurance, admin costs)';