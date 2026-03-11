

# Plan: Fix David Ramage — Create Proper Contact and Unlink from Punit Shah

## Problem

Pipeline entry `e9a27514` has:
- `lead_name = 'David Ramage'` (correct — from our previous fix)
- `contact_id = 782ae5c6` → **Punit Shah** (wrong — false phone dedup linked them)
- No "David Ramage" contact record exists in the database

The Kanban card shows "Punit Shah" because it falls back to the contact name. The lead detail page shows "David Ramage" because it reads `lead_name`.

## Fix

### 1. SQL Migration — Create David Ramage contact + repoint pipeline entry

A single migration that:
1. Creates a new contact record for "David Ramage" with the address from the lead detail page (`4171 101st Ave E, Parrish, FL 34219`) and phone `111111111`, using the same `tenant_id` (`14de934e-7964-4afd-940a-620d2ace125d`) and `location_id` (`c490231c-2a0e-4afc-8412-672e1c890c16` — West Coast)
2. Updates pipeline entry `e9a27514` to point `contact_id` to the new David Ramage contact
3. The `contact_number` will be auto-assigned by the existing `assign_contact_number` trigger

### 2. No code changes needed

The Kanban card already prioritizes `lead_name` over contact name (line 159 in `KanbanCard.tsx`), but it also displays the contact name in a secondary position. Once the contact is correctly "David Ramage", everything will align.

