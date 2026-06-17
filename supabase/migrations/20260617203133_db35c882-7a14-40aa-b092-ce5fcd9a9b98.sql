
-- Clear off-page signature anchor on the affected estimate so finalize-envelope falls back to safe placement
UPDATE public.enhanced_estimates
SET signature_anchor = NULL
WHERE id = '2e7b3bfd-b6c5-477e-8ca6-40c660b65370'
  AND signature_anchor->>'yPt' LIKE '-%';

-- Reset envelope so it can be re-finalized
UPDATE public.signature_envelopes
SET status = 'sent',
    completed_at = NULL,
    final_pdf_hash = NULL,
    signed_pdf_path = NULL,
    document_url = NULL
WHERE id = 'e928715b-6e6a-412a-9c07-489e0059e841';

-- Remove the previous (blank-looking) signed document so the re-finalize creates a fresh one
DELETE FROM public.documents
WHERE id = 'c8bab290-8792-4f22-b9a1-bc6cd1469362';
