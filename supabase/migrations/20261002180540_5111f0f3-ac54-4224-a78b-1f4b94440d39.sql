REVOKE ALL ON FUNCTION public.commercial_commitment_header_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commercial_commitment_line_trigger() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commercial_commitment_header_rollup() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.commercial_recompute_commitments(uuid) FROM PUBLIC, anon, authenticated;