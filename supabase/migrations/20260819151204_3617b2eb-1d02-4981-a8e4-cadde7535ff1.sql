ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_commission_structure_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_commission_structure_check
  CHECK (commission_structure IS NULL OR commission_structure = ANY (ARRAY['profit_split'::text,'sales_percentage'::text,'percentage_contract_price'::text]));