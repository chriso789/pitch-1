-- Fix Max Wensinger's company assignment to Under One Roof
DO $$
DECLARE
  v_max_user_id uuid;
  v_under_one_roof_id uuid := '5a02983a-3d4d-4d5e-af01-7f2c7f02e78c';
BEGIN
  -- Find Max Wensinger's user ID
  SELECT id INTO v_max_user_id
  FROM profiles
  WHERE first_name ILIKE '%max%' AND last_name ILIKE '%wensinger%'
  LIMIT 1;
  
  IF v_max_user_id IS NOT NULL THEN
    -- Update Max's profile to Under One Roof
    UPDATE profiles
    SET 
      tenant_id = v_under_one_roof_id,
      company_name = 'Under One Roof'
    WHERE id = v_max_user_id;
    
    -- Upsert company access for Under One Roof
    INSERT INTO user_company_access (user_id, tenant_id, is_active, access_level)
    VALUES (v_max_user_id, v_under_one_roof_id, true, 'full')
    ON CONFLICT (user_id, tenant_id) DO UPDATE
    SET is_active = true, access_level = 'full';
    
    RAISE NOTICE 'Fixed Max Wensinger (%) - assigned to Under One Roof', v_max_user_id;
  ELSE
    RAISE NOTICE 'Max Wensinger not found in profiles table';
  END IF;
END $$;