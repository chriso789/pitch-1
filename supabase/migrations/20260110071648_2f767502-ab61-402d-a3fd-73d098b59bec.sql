-- Allow master users to update settings_tabs
CREATE POLICY "Master users can update settings tabs"
ON public.settings_tabs
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role = 'master'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role = 'master'
  )
);

-- Also add INSERT and DELETE policies for master users to fully manage tabs
CREATE POLICY "Master users can insert settings tabs"
ON public.settings_tabs
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role = 'master'
  )
);

CREATE POLICY "Master users can delete settings tabs"
ON public.settings_tabs
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = auth.uid()
    AND profiles.role = 'master'
  )
);