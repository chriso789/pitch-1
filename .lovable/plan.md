

# Import and Reconcile Grosso/Uri Contacts to East Coast

## Summary
The uploaded spreadsheet contains approximately 200+ unique contacts (with many duplicate rows) assigned to either **Michael Grosso** or **Uri Kaweblum**. All need to be in the **East Coast** location for O'Brien Contracting. The database already shows 223 Grosso contacts and 25 Uri contacts in East Coast, so many likely exist already.

## Data Extracted
- **Rep assignments**: ~335 lines for Michael Grosso, ~155 lines for Uri Kaweblum (with heavy duplication)
- **Cities covered**: Delray Beach, Boynton Beach, Boca Raton, West Palm Beach, Royal Palm Beach, Riviera Beach, Sunrise, Parkland, Coconut Creek, Coral Springs, Lighthouse Point, Pompano Beach, Tampa, Lake Worth, Greenacres, Loxahatchee
- **Key fields per row**: Name, Address, City, State, Zip, Rep, Notes, Phone numbers

## Key IDs
- **Tenant**: `14de934e-7964-4afd-940a-620d2ace125d` (O'Brien Contracting)
- **East Coast location**: `acb2ee85-d4f7-4a4e-9b97-cd421554b8af`
- **Michael Grosso**: `f828ec8a-07e9-4d20-a642-a60cb320fede`
- **Uri Kaweblum**: `9affa87c-4f01-45b8-a494-0a294beb1383`

## Plan

### Step 1: Create an Edge Function for Bulk Contact Reconciliation
Build a `reconcile-contacts` edge function that:
1. Accepts the deduplicated contact list (parsed from the spreadsheet)
2. For each contact, checks if they already exist in the database by matching on normalized `first_name` + `last_name` + `address_street` within the O'Brien tenant
3. **If the contact exists**: Updates `assigned_to` to the correct rep and ensures `location_id` is East Coast
4. **If the contact does not exist**: Inserts a new record with:
   - Correct `tenant_id`, `location_id` (East Coast), `assigned_to` (Grosso or Uri)
   - `first_name`, `last_name`, `address_street`, `address_city`, `address_state`, `address_zip`
   - `phone` (primary phone from the spreadsheet)
   - `notes` (from column 8 of the spreadsheet)
   - `lead_source` = `'csv_import'`

### Step 2: Build the Deduplicated Contact Payload
Parse the spreadsheet into unique contacts (by name + address), keeping only the most recent entry per contact. Map the rep name to the correct profile ID.

### Step 3: Call the Edge Function
Invoke the function with the full payload to reconcile all contacts in one batch operation.

## Deduplication Strategy
- Within the spreadsheet: deduplicate by `UPPER(name) + UPPER(address)`
- Against the database: match on `LOWER(first_name) = LOWER(?) AND LOWER(last_name) = LOWER(?) AND LOWER(address_street) LIKE LOWER(?%)` within the tenant
- Also check by phone number as a secondary match to catch name variations

## Result
All contacts from the spreadsheet will be present in the database, assigned to the correct rep (Grosso or Uri), in the East Coast location, with no duplicates created.

