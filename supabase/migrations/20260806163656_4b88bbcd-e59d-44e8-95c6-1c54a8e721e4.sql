CREATE POLICY "Only owner or master can edit payments"
ON public.project_payments
AS RESTRICTIVE
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'owner'::app_role) OR public.has_role(auth.uid(), 'master'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'owner'::app_role) OR public.has_role(auth.uid(), 'master'::app_role));

CREATE POLICY "Only owner or master can delete payments"
ON public.project_payments
AS RESTRICTIVE
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'owner'::app_role) OR public.has_role(auth.uid(), 'master'::app_role));