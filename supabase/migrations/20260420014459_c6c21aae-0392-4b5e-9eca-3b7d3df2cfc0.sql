
-- Restrict insurance_network_contributions to authenticated users only.
DROP POLICY IF EXISTS "network_read_all" ON public.insurance_network_contributions;

CREATE POLICY "Authenticated users can read network contributions"
ON public.insurance_network_contributions
FOR SELECT
TO authenticated
USING (true);
