-- Rename mislabeled document to match its actual file content
UPDATE public.documents
SET
  filename = 'Final Lien Release.pdf',
  updated_at = now()
WHERE id = 'e579fcb6-ccf4-47f1-9d51-2776b293c45d'
  AND tenant_id = '14de934e-7964-4afd-940a-620d2ace125d'
  AND file_path = 'company-docs/1767541022252-workmanship_lien_release.pdf';