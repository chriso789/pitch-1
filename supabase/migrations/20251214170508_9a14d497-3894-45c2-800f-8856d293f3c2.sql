-- Remove redundant lead-sources sidebar tab
-- Lead Sources is already accessible via General Settings → Lead Sources sub-tab
DELETE FROM settings_tabs WHERE tab_key = 'lead-sources';