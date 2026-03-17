-- Update O'Brien Contracting material catalog to match SRS Jan 2026 pricelist
-- Tenant: 14de934e-7964-4afd-940a-620d2ace125d

-- Shingles (SRS quotes per-SQ, DB stores per-bundle = SQ price ÷ 3)
UPDATE materials SET base_cost = 37.67, updated_at = now() WHERE id = '56ab0a72-48f0-4744-b727-64b0423e749c'; -- CT Landmark: $113/SQ ÷ 3
UPDATE materials SET base_cost = 38.33, updated_at = now() WHERE id = 'daa9fdbb-3b27-4f8f-bf8d-973353a87c6f'; -- GAF HDZ: $115/SQ ÷ 3

-- Starters (per-bundle pricing from PDF)
UPDATE materials SET base_cost = 55.00, updated_at = now() WHERE id = '7789a51c-e679-4b5d-a9a0-57ac51934ffd'; -- CT SwiftStart: was $34
UPDATE materials SET base_cost = 54.50, updated_at = now() WHERE id = 'acc7d706-fb40-455c-83a6-041c4600358d'; -- GAF Pro-Start: was $35

-- Hip & Ridge caps (per-bundle pricing from PDF)
UPDATE materials SET base_cost = 69.75, updated_at = now() WHERE id = '37c1267c-f0a4-4a89-b9c6-008c445ef63f'; -- CT Shadow Ridge: was $50
UPDATE materials SET base_cost = 59.00, updated_at = now() WHERE id = '3019db42-1dc5-4329-bc2e-6fa5c7466d7d'; -- GAF Seal-A-Ridge: was $52

-- Ice & Water (per-roll pricing from PDF)
UPDATE materials SET base_cost = 97.50, updated_at = now() WHERE id = 'dd35bf50-7f5d-469d-8a9f-358d807ccabc'; -- CT WinterGuard: was $120
UPDATE materials SET base_cost = 107.50, updated_at = now() WHERE id = 'c130c2fe-ded8-4e4e-ba60-d312c29bf00d'; -- GAF StormGuard: was $125

-- Underlayments (per-roll pricing from PDF)
UPDATE materials SET base_cost = 95.00, updated_at = now() WHERE id = '889ee5c8-aaaa-4bf1-8a50-b7b58c5647a9'; -- GAF FeltBuster: was $85
UPDATE materials SET base_cost = 85.00, updated_at = now() WHERE id = 'b2ddb4e4-3395-4a68-839a-1a3a6953e1d4'; -- CT DiamondDeck/Roofrunner: was $90