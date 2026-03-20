

# Backfill Line Item Descriptions from Materials Table

## Problem
The `enhanced_estimates.line_items` JSONB stores materials and labor arrays. Many line items are missing the `description` field, even though the `materials` table was recently updated with descriptions from the uploaded PDFs.

## Approach
Run a SQL migration that updates the JSONB `line_items` in `enhanced_estimates` by matching each item's `item_name` to `materials.name` and injecting the `description` from the materials table.

## Changes

### File: New SQL migration

A single SQL statement that:
1. For each `enhanced_estimates` row with `line_items`
2. Iterates through both `materials` and `labor` arrays in the JSONB
3. For items missing a description, looks up `materials.name` matching `item_name`
4. Injects the `description` from the materials table into the JSONB element
5. Updates the row

This uses a PL/pgSQL block to iterate estimates, rebuild the arrays with descriptions filled in, and update in place. Both `materials` and `labor` arrays are processed since labor items (like "Tear Off", "Cleanup/Haul", "Panel Install") also exist in the materials table with descriptions.

No application code changes needed — this is a data-only migration.

