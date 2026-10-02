REVOKE ALL ON FUNCTION public.commercial_vendor_invoice_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commercial_vendor_invoice_rollup() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commercial_invoice_line_trigger() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commercial_cost_entry_rollup() FROM PUBLIC, anon, authenticated;