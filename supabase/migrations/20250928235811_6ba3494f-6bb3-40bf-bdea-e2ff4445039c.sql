-- Add clj_formatted_number column to pipeline_entries
ALTER TABLE public.pipeline_entries 
ADD COLUMN clj_formatted_number TEXT;

-- Create sequence for C-L-J numbering
CREATE SEQUENCE IF NOT EXISTS clj_number_seq START 1;

-- Create function to generate C-L-J formatted numbers
CREATE OR REPLACE FUNCTION public.generate_clj_number()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    next_num INTEGER;
    clj_num TEXT;
BEGIN
    next_num := nextval('clj_number_seq');
    clj_num := 'C' || LPAD(next_num::TEXT, 3, '0') || '-L' || LPAD(next_num::TEXT, 3, '0') || '-J' || LPAD(next_num::TEXT, 3, '0');
    RETURN clj_num;
END;
$$;

-- Create trigger function to auto-assign C-L-J numbers
CREATE OR REPLACE FUNCTION public.auto_assign_clj_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    IF NEW.clj_formatted_number IS NULL THEN
        NEW.clj_formatted_number := generate_clj_number();
    END IF;
    RETURN NEW;
END;
$$;

-- Create trigger to auto-assign C-L-J numbers on insert
CREATE TRIGGER trigger_auto_assign_clj_number
    BEFORE INSERT ON public.pipeline_entries
    FOR EACH ROW
    EXECUTE FUNCTION public.auto_assign_clj_number();

-- Migrate existing records to have C-L-J numbers
UPDATE public.pipeline_entries 
SET clj_formatted_number = generate_clj_number()
WHERE clj_formatted_number IS NULL;