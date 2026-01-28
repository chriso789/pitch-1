-- Add sales tax settings to tenant_estimate_settings
ALTER TABLE tenant_estimate_settings
ADD COLUMN IF NOT EXISTS sales_tax_enabled boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS sales_tax_rate numeric(5,3) DEFAULT 0;

COMMENT ON COLUMN tenant_estimate_settings.sales_tax_enabled IS 'Whether sales tax is applied to estimates';
COMMENT ON COLUMN tenant_estimate_settings.sales_tax_rate IS 'Sales tax percentage (e.g., 7.25 for 7.25%)';

-- Add sales tax columns to enhanced_estimates to store the applied rate per estimate
ALTER TABLE enhanced_estimates
ADD COLUMN IF NOT EXISTS sales_tax_rate numeric(5,3) DEFAULT 0,
ADD COLUMN IF NOT EXISTS sales_tax_amount numeric(10,2) DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_with_tax numeric(10,2);