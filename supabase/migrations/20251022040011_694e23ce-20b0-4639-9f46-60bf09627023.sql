-- Clean up old contact numbering system that conflicts with C-L-J system
-- Drop old trigger that conflicts with new C-L-J system
DROP TRIGGER IF EXISTS assign_contact_number_trigger ON public.contacts;

-- Drop old contact number function
DROP FUNCTION IF EXISTS public.auto_assign_contact_number();
DROP FUNCTION IF EXISTS public.generate_contact_number(uuid);

-- Drop old sequence
DROP SEQUENCE IF EXISTS public.contact_number_seq;