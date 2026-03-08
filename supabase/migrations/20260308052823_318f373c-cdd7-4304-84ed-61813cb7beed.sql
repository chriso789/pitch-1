-- One-time data fix: update East Coast location to use Telnyx-provisioned number
UPDATE public.locations 
SET telnyx_phone_number = '+15613144201', 
    phone_porting_status = 'active' 
WHERE id = 'acb2ee85-d4f7-4a4e-9b97-cd421554b8af';