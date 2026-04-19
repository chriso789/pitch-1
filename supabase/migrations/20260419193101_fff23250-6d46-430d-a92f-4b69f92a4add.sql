-- Remove all xactimate vendor reports and detach references
UPDATE public.roof_training_sessions SET vendor_report_id = NULL
WHERE vendor_report_id IN (SELECT id FROM public.roof_vendor_reports WHERE provider = 'xactimate');

UPDATE public.roof_measurements SET vendor_report_id = NULL
WHERE vendor_report_id IN (SELECT id FROM public.roof_vendor_reports WHERE provider = 'xactimate');

DELETE FROM public.roof_vendor_reports WHERE provider = 'xactimate';