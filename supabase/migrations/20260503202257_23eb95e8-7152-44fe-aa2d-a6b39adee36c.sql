UPDATE roof_measurements 
SET internal_debug_report_ready = true 
WHERE validation_status = 'failed' 
  AND internal_debug_report_ready = false 
  AND gate_reason IS NOT NULL;