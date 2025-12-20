-- Add delivery status tracking columns to communication_history
ALTER TABLE public.communication_history 
ADD COLUMN IF NOT EXISTS delivery_status TEXT DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS delivery_status_updated_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS carrier_error_code TEXT;

-- Add index for querying by delivery status
CREATE INDEX IF NOT EXISTS idx_communication_history_delivery_status 
ON public.communication_history(delivery_status);

-- Add index for querying by telnyx message id (stored in metadata)
CREATE INDEX IF NOT EXISTS idx_communication_history_metadata_gin 
ON public.communication_history USING gin(metadata);

COMMENT ON COLUMN public.communication_history.delivery_status IS 'SMS delivery status: pending, queued, sending, sent, delivered, failed, undelivered';
COMMENT ON COLUMN public.communication_history.delivery_status_updated_at IS 'Timestamp when delivery status was last updated';
COMMENT ON COLUMN public.communication_history.carrier_error_code IS 'Carrier error code for failed messages';