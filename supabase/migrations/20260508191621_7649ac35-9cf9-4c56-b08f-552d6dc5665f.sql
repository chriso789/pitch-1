SET session_replication_role = replica;
UPDATE public.pipeline_entries
SET location_id = 'c490231c-2a0e-4afc-8412-672e1c890c16'
WHERE contact_id = '9b5ed0b1-5dc4-4034-ad25-67dccf29d1ef';
SET session_replication_role = DEFAULT;