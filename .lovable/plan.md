

# Update East Coast Location Phone Number

## What

Update the East Coast location record to use the Telnyx-provisioned number `+15613144201` instead of the unported `+12399194485`.

## How

Single data update via the insert tool:

```sql
UPDATE locations 
SET telnyx_phone_number = '+15613144201', 
    phone_porting_status = 'active' 
WHERE id = 'acb2ee85-d4f7-4a4e-9b97-cd421554b8af';
```

This will immediately allow the East Coast location to place outbound calls through the dialer using this Telnyx number as the caller ID / origination number.

No code changes needed — the dialer already reads `telnyx_phone_number` from the location record.

