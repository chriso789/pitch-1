-- Add contact_id to dialer_list_items for CRM contact linking
ALTER TABLE dialer_list_items ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES contacts(id);
CREATE INDEX IF NOT EXISTS idx_dialer_list_items_contact_id ON dialer_list_items(contact_id);

-- Add list_item_id to calls for tracking which dialer item triggered the call
ALTER TABLE calls ADD COLUMN IF NOT EXISTS list_item_id UUID REFERENCES dialer_list_items(id);
CREATE INDEX IF NOT EXISTS idx_calls_list_item_id ON calls(list_item_id);