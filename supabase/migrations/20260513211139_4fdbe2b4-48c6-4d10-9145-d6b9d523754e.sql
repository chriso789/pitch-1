-- Strip stray backslash before quote/apostrophe/backslash characters
UPDATE supplier_price_list_items
SET item_description = regexp_replace(item_description, '\\([\"''\\])', '\1', 'g'),
    normalized_description = lower(regexp_replace(coalesce(normalized_description, item_description), '\\([\"''\\])', '\1', 'g'))
WHERE item_description ~ '\\[\"''\\]' OR normalized_description ~ '\\[\"''\\]';

UPDATE material_invoice_line_items
SET item_description = regexp_replace(item_description, '\\([\"''\\])', '\1', 'g'),
    normalized_description = lower(regexp_replace(coalesce(normalized_description, item_description), '\\([\"''\\])', '\1', 'g'))
WHERE item_description ~ '\\[\"''\\]' OR normalized_description ~ '\\[\"''\\]';

UPDATE material_invoice_audit_lines
SET invoice_description = regexp_replace(coalesce(invoice_description,''), '\\([\"''\\])', '\1', 'g'),
    agreed_description = CASE WHEN agreed_description IS NULL THEN NULL
                              ELSE regexp_replace(agreed_description, '\\([\"''\\])', '\1', 'g') END
WHERE invoice_description ~ '\\[\"''\\]' OR agreed_description ~ '\\[\"''\\]';

UPDATE material_item_match_rules
SET normalized_invoice_description = regexp_replace(normalized_invoice_description, '\\([\"''\\])', '\1', 'g')
WHERE normalized_invoice_description ~ '\\[\"''\\]';