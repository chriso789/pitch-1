-- ============================================================
-- DEMO SHOWCASE TENANT
-- ============================================================
DO $$
DECLARE
  v_tenant uuid := '11111111-1111-4111-8111-111111111111';
  v_loc    uuid := '11111111-1111-4111-8111-111111111112';
  v_qbo    uuid := '11111111-1111-4111-8111-111111111113';
  v_owner  uuid := '11111111-1111-4111-8111-1111111110a1';
  v_admin  uuid := '11111111-1111-4111-8111-1111111110a2';
  v_pm     uuid := '11111111-1111-4111-8111-1111111110a3';
  v_rep1   uuid := '11111111-1111-4111-8111-1111111110a4';
  v_rep2   uuid := '11111111-1111-4111-8111-1111111110a5';
  v_rep3   uuid := '11111111-1111-4111-8111-1111111110a6';
  v_users  jsonb;
  u        jsonb;
  reps     uuid[];
  i        int;
  v_contact uuid;
  v_lead    uuid;
  v_est     uuid;
  v_proj    uuid;
  v_rep     uuid;
  v_status  public.pipeline_status;
  v_est_status public.estimate_status;
  v_contract numeric;
  v_mat numeric;
  v_lab numeric;
  v_oh numeric;
  v_gross numeric;
  v_net numeric;
  v_ctype text;
  v_crate numeric;
  v_camt numeric;
  v_created timestamptz;
  v_streets text[] := ARRAY['Fonsica Ave','Palm Grove Dr','Sunridge Ct','Belmont Rd','Cypress Bend','Harborview Ln','Kingsley St','Maple Crest Dr','Oakmont Way','Riverstone Pl'];
  v_cities  text[] := ARRAY['Tampa','Brandon','Lutz','Clearwater','Sarasota'];
  v_first   text[] := ARRAY['James','Maria','Robert','Linda','David','Karen','Michael','Susan','Daniel','Nancy'];
  v_last    text[] := ARRAY['Alvarez','Bennett','Carver','Delgado','Ellison','Fletcher','Grant','Hollis','Ingram','Jensen'];
  v_roof    text[] := ARRAY['shingle','metal','tile','flat'];
BEGIN
  -- ---------- Company ----------
  INSERT INTO public.tenants (
    id, name, subdomain, is_active, primary_color, secondary_color, phone, email,
    address_street, address_city, address_state, address_zip, website, license_number,
    company_overhead_rate, owner_name, owner_email, owner_phone, subscription_tier,
    subscription_status, billing_email, brand_tagline, brand_headline, about_us,
    payment_terms, warranty_terms, settings
  ) VALUES (
    v_tenant, 'Summit Ridge Roofing (DEMO)', 'summit-ridge-demo', true, '#0F3460', '#E94560',
    '+18135550100', 'info@demo.pitch-crm.ai', '4200 Summit Ridge Blvd', 'Tampa', 'FL', '33607',
    'https://demo.pitch-crm.ai', 'CCC1330000', 12,
    'Avery Sinclair', 'owner@demo.pitch-crm.ai', '+18135550101', 'enterprise',
    'active', 'billing@demo.pitch-crm.ai', 'Roofing done right, the first time.',
    'Florida''s trusted storm restoration team',
    'Summit Ridge Roofing is a demonstration company used to showcase the Pitch CRM platform end to end.',
    'Net 15 from substantial completion.', '10-year workmanship warranty on all installations.',
    jsonb_build_object('is_demo', true, 'demo_seed_version', 1)
  )
  ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, is_active = true, settings = EXCLUDED.settings;

  INSERT INTO public.tenant_settings (tenant_id, min_profit_margin_percent, default_target_margin_percent,
    portal_show_photos, portal_show_documents, portal_show_balance, portal_show_messages)
  VALUES (v_tenant, 25, 38, true, true, true, true)
  ON CONFLICT DO NOTHING;

  -- ---------- Location ----------
  INSERT INTO public.locations (id, tenant_id, name, address_street, address_city, address_state,
    address_zip, phone, email, is_active, is_primary, location_code, latitude, longitude)
  VALUES (v_loc, v_tenant, 'Tampa HQ (DEMO)', '4200 Summit Ridge Blvd', 'Tampa', 'FL', '33607',
    '+18135550100', 'tampa@demo.pitch-crm.ai', true, true, 'TPA', 27.9506, -82.4572)
  ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, is_active = true;

  INSERT INTO public.business_locations (tenant_id, name, code, is_headquarters, status, phone, email)
  VALUES (v_tenant, 'Tampa HQ (DEMO)', 'TPA', true, 'active', '+18135550100', 'tampa@demo.pitch-crm.ai')
  ON CONFLICT DO NOTHING;

  -- ---------- Demo users (auth + profiles) ----------
  v_users := jsonb_build_array(
    jsonb_build_object('id', v_owner, 'email','owner@demo.pitch-crm.ai','first','Avery','last','Sinclair','role','owner','title','Owner','structure','profit_split','rate',50),
    jsonb_build_object('id', v_admin, 'email','admin@demo.pitch-crm.ai','first','Rosa','last','Nunez','role','office_admin','title','Office Administrator','structure',NULL,'rate',NULL),
    jsonb_build_object('id', v_pm,    'email','pm@demo.pitch-crm.ai','first','Curtis','last','Boyd','role','project_manager','title','Production Manager','structure',NULL,'rate',NULL),
    jsonb_build_object('id', v_rep1,  'email','rep1@demo.pitch-crm.ai','first','Nolan','last','Reyes','role','sales_manager','title','Sales Manager','structure','profit_split','rate',45),
    jsonb_build_object('id', v_rep2,  'email','rep2@demo.pitch-crm.ai','first','Tessa','last','Marsh','role','sales_manager','title','Senior Sales Rep','structure','percentage_contract_price','rate',10),
    jsonb_build_object('id', v_rep3,  'email','rep3@demo.pitch-crm.ai','first','Devin','last','Okafor','role','sales_manager','title','Sales Rep','structure','percentage_contract_price','rate',8)
  );

  FOR u IN SELECT * FROM jsonb_array_elements(v_users) LOOP
    INSERT INTO auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) VALUES (
      '00000000-0000-0000-0000-000000000000', (u->>'id')::uuid, 'authenticated', 'authenticated',
      u->>'email', crypt('DemoPitch2026!', gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('first_name', u->>'first', 'last_name', u->>'last', 'tenant_id', v_tenant, 'is_demo', true),
      now(), now()
    ) ON CONFLICT (id) DO NOTHING;

    INSERT INTO auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    SELECT u->>'email', (u->>'id')::uuid,
      jsonb_build_object('sub', u->>'id', 'email', u->>'email', 'email_verified', true, 'phone_verified', false),
      'email', now(), now(), now()
    WHERE NOT EXISTS (
      SELECT 1 FROM auth.identities WHERE provider = 'email' AND user_id = (u->>'id')::uuid
    );

    INSERT INTO public.profiles (
      id, tenant_id, active_tenant_id, first_name, last_name, email, company_email, phone,
      is_active, role, title, company_name, pay_type, commission_structure, commission_rate,
      commission_rate_self_generated, commission_rate_company_generated, overhead_rate,
      personal_overhead_rate, active_location_id, metadata
    ) VALUES (
      (u->>'id')::uuid, v_tenant, v_tenant, u->>'first', u->>'last', u->>'email', u->>'email',
      '+1813555' || lpad(('x' || right(u->>'id', 2))::bit(8)::int::text, 4, '0'),
      true, (u->>'role')::public.app_role, u->>'title', 'Summit Ridge Roofing (DEMO)',
      CASE WHEN u->>'structure' IS NULL THEN 'hourly' ELSE 'commission' END,
      u->>'structure', (u->>'rate')::numeric,
      CASE WHEN u->>'structure' = 'percentage_contract_price' THEN (u->>'rate')::numeric END,
      CASE WHEN u->>'structure' = 'percentage_contract_price' THEN GREATEST((u->>'rate')::numeric - 3, 1) END,
      8, 8, v_loc, jsonb_build_object('is_demo', true)
    )
    ON CONFLICT (id) DO UPDATE SET tenant_id = v_tenant, active_tenant_id = v_tenant,
      role = EXCLUDED.role, is_active = true, metadata = EXCLUDED.metadata;

    INSERT INTO public.user_company_access (user_id, tenant_id, is_active, access_level, granted_at)
    VALUES ((u->>'id')::uuid, v_tenant, true, 'full', now())
    ON CONFLICT DO NOTHING;
  END LOOP;

  reps := ARRAY[v_rep1, v_rep2, v_rep3];

  -- ---------- Integrations (demo credentials only) ----------
  INSERT INTO public.qbo_connections (id, tenant_id, realm_id, qbo_company_name, access_token,
    refresh_token, expires_at, token_expires_at, scopes, is_active, connected_at, is_sandbox, connected_by, metadata)
  VALUES (v_qbo, v_tenant, 'DEMO-REALM-9000000001', 'Summit Ridge Roofing (DEMO)',
    'demo-access-token-not-valid', 'demo-refresh-token-not-valid',
    now() + interval '30 days', now() + interval '30 days',
    ARRAY['com.intuit.quickbooks.accounting'], true, now(), true, v_owner,
    jsonb_build_object('is_demo', true))
  ON CONFLICT (id) DO UPDATE SET is_active = true, qbo_company_name = EXCLUDED.qbo_company_name;

  INSERT INTO public.abc_connections (tenant_id, environment, connection_status, account_id, account_name,
    account_number, client_id, client_secret_last_four, default_branch_code, last_validated_at, connected_by)
  VALUES (v_tenant, 'production', 'connected', 'DEMO-ABC-1001', 'Summit Ridge Roofing (DEMO)',
    '1001DEMO', 'demo-abc-client', '4242', '063', now(), v_owner)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.srs_connections (tenant_id, customer_code, customer_name, connection_status,
    environment, default_branch_code, home_branch_code, job_account_number, client_secret_last_four,
    last_validated_at, last_sync_at)
  VALUES (v_tenant, 'DEMO-SRS-2002', 'Summit Ridge Roofing (DEMO)', 'connected',
    'production', '921', '921', 2002, '1337', now(), now())
  ON CONFLICT DO NOTHING;

  INSERT INTO public.tenant_stripe_accounts (tenant_id, stripe_account_id, account_type, country,
    default_currency, charges_enabled, payouts_enabled, details_submitted, onboarding_complete, created_by)
  VALUES (v_tenant, 'acct_demo_summitridge', 'express', 'US', 'usd', true, true, true, true, v_owner)
  ON CONFLICT DO NOTHING;

  -- ---------- 100 demo leads / estimates / projects / accounting ----------
  FOR i IN 1..100 LOOP
    v_rep := reps[1 + (i % 3)];
    v_created := now() - ((150 - i) || ' days')::interval;
    v_contract := 12000 + ((i * 917) % 53000);
    v_mat := round(v_contract * 0.40, 2);
    v_lab := round(v_contract * 0.22, 2);
    v_oh  := round(v_contract * 0.08, 2);
    v_gross := v_contract - v_mat - v_lab;
    v_net := v_gross - v_oh;

    v_status := (CASE (i % 9)
      WHEN 0 THEN 'lead' WHEN 1 THEN 'legal' WHEN 2 THEN 'contingency'
      WHEN 3 THEN 'ready_for_approval' WHEN 4 THEN 'production' WHEN 5 THEN 'final_payment'
      WHEN 6 THEN 'closed' WHEN 7 THEN 'completed' ELSE 'lost' END)::public.pipeline_status;

    v_est_status := (CASE WHEN v_status IN ('lead','legal') THEN 'draft'
      WHEN v_status = 'contingency' THEN 'sent'
      WHEN v_status = 'lost' THEN 'rejected' ELSE 'approved' END)::public.estimate_status;

    INSERT INTO public.contacts (tenant_id, type, first_name, last_name, email, phone,
      address_street, address_city, address_state, address_zip, lead_source, location_id,
      assigned_to, created_by, qualification_status, is_deleted, created_at, metadata)
    VALUES (v_tenant, 'homeowner',
      v_first[1 + (i % 10)], v_last[1 + ((i / 3) % 10)],
      'demo.customer' || i || '@example.com', '+1813556' || lpad(i::text, 4, '0'),
      (1000 + i * 7) || ' ' || v_streets[1 + (i % 10)], v_cities[1 + (i % 5)], 'FL',
      '336' || lpad((10 + (i % 80))::text, 2, '0'),
      (ARRAY['referral','canvassing','online','advertisement','social_media'])[1 + (i % 5)],
      v_loc, v_rep, v_owner,
      CASE WHEN v_status = 'lost' THEN 'unqualified' ELSE 'qualified' END,
      false, v_created, jsonb_build_object('is_demo', true))
    RETURNING id INTO v_contact;

    INSERT INTO public.pipeline_entries (tenant_id, contact_id, status, source, roof_type, priority,
      estimated_value, probability_percent, expected_close_date, assigned_to, created_by, location_id,
      lead_generation_type, lead_name, notes, is_deleted, created_at, status_entered_at, metadata)
    VALUES (v_tenant, v_contact, v_status,
      (ARRAY['referral','canvassing','online','advertisement','social_media'])[1 + (i % 5)]::public.lead_source,
      v_roof[1 + (i % 4)]::public.roof_type,
      (ARRAY['low','medium','high'])[1 + (i % 3)],
      v_contract, CASE WHEN v_status = 'lost' THEN 0 WHEN v_status IN ('lead','legal') THEN 40 ELSE 90 END,
      (v_created + interval '30 days')::date, v_rep, v_owner, v_loc,
      CASE WHEN i % 2 = 0 THEN 'self_generated' ELSE 'company_generated' END,
      'Demo Lead ' || i, 'Seeded demo lead for platform showcase.', false, v_created, v_created,
      jsonb_build_object('is_demo', true))
    RETURNING id INTO v_lead;

    INSERT INTO public.estimates (tenant_id, pipeline_entry_id, status, material_cost, labor_cost,
      overhead_percent, overhead_amount, target_margin_percent, selling_price, actual_profit,
      actual_margin_percent, valid_until, sent_at, approved_at, created_by, location_id, created_at, parameters)
    VALUES (v_tenant, v_lead, v_est_status, v_mat, v_lab, 8, v_oh, 38, v_contract, v_net,
      round((v_net / v_contract) * 100, 2), (v_created + interval '30 days')::date,
      CASE WHEN v_est_status <> 'draft' THEN v_created + interval '2 days' END,
      CASE WHEN v_est_status = 'approved' THEN v_created + interval '5 days' END,
      v_rep, v_loc, v_created, jsonb_build_object('is_demo', true))
    RETURNING id INTO v_est;

    INSERT INTO public.enhanced_estimates (id, tenant_id, estimate_number, pipeline_entry_id,
      customer_name, customer_address, roof_area_sq_ft, roof_pitch, material_cost, material_total,
      labor_cost, labor_total, overhead_percent, overhead_amount, sales_rep_id, subtotal,
      target_profit_percent, actual_profit_amount, actual_profit_percent, selling_price,
      status, created_by, created_at, notes, line_items)
    VALUES (v_est, v_tenant, 'DEMO-EST-' || lpad(i::text, 4, '0'), v_lead,
      v_first[1 + (i % 10)] || ' ' || v_last[1 + ((i / 3) % 10)],
      (1000 + i * 7) || ' ' || v_streets[1 + (i % 10)] || ', ' || v_cities[1 + (i % 5)] || ', FL',
      round(v_contract / 4.0, 2), '6/12', v_mat, v_mat, v_lab, v_lab, 8, v_oh, v_rep,
      v_mat + v_lab + v_oh, 38, v_net, round((v_net / v_contract) * 100, 2), v_contract,
      (CASE WHEN v_est_status = 'draft' THEN 'draft'
            WHEN v_est_status = 'approved' THEN 'signed'
            ELSE 'sent' END)::public.estimate_status,
      v_rep, v_created, 'Seeded demo estimate',
      jsonb_build_array(
        jsonb_build_object('category','materials','item_name','Architectural Shingles',
          'description','GAF Timberline HDZ','quantity', round(v_contract / 400.0, 2),
          'unit_type','SQ','unit_cost', 118, 'total_price', round(v_mat * 0.7, 2)),
        jsonb_build_object('category','materials','item_name','Underlayment & Accessories',
          'description','Synthetic underlayment, drip edge, ridge vent','quantity', 1,
          'unit_type','LOT','unit_cost', round(v_mat * 0.3, 2), 'total_price', round(v_mat * 0.3, 2)),
        jsonb_build_object('category','labor','item_name','Tear-off & Install',
          'description','Full tear-off and re-roof labor','quantity', 1,
          'unit_type','LOT','unit_cost', v_lab, 'total_price', v_lab)
      ));

    -- Projects for everything at/after ready_for_approval
    IF v_status IN ('ready_for_approval','production','final_payment','closed','completed') THEN
      INSERT INTO public.projects (tenant_id, pipeline_entry_id, name, description, status,
        start_date, estimated_completion_date, actual_completion_date, project_manager_id,
        created_by, location_id, created_at, metadata)
      VALUES (v_tenant, v_lead, 'Demo Project ' || i || ' - ' || v_streets[1 + (i % 10)],
        'Seeded demo project for platform showcase.',
        CASE WHEN v_status IN ('closed','completed') THEN 'completed'
             WHEN v_status = 'production' THEN 'in_progress' ELSE 'active' END,
        (v_created + interval '10 days')::date, (v_created + interval '25 days')::date,
        CASE WHEN v_status IN ('closed','completed') THEN (v_created + interval '24 days')::date END,
        v_pm, v_owner, v_loc, v_created, jsonb_build_object('is_demo', true))
      RETURNING id INTO v_proj;

      INSERT INTO public.project_budget_items (tenant_id, project_id, category, item_name,
        budgeted_quantity, budgeted_unit_cost, budgeted_total_cost, actual_quantity,
        actual_unit_cost, actual_total_cost, vendor_name, created_by)
      VALUES
        (v_tenant, v_proj, 'materials', 'Roofing Materials', 1, v_mat, v_mat, 1,
          round(v_mat * 1.03, 2), round(v_mat * 1.03, 2), 'ABC Supply (DEMO)', v_owner),
        (v_tenant, v_proj, 'labor', 'Install Crew', 1, v_lab, v_lab, 1,
          round(v_lab * 0.97, 2), round(v_lab * 0.97, 2), 'Summit Crew A (DEMO)', v_owner);

      INSERT INTO public.project_invoices (tenant_id, pipeline_entry_id, invoice_number, amount,
        balance, status, due_date, sent_at, created_by, created_at, notes)
      VALUES (v_tenant, v_lead, 'DEMO-INV-' || lpad(i::text, 4, '0'), v_contract,
        CASE WHEN v_status IN ('closed','completed') THEN 0
             WHEN v_status = 'final_payment' THEN round(v_contract * 0.5, 2) ELSE v_contract END,
        CASE WHEN v_status IN ('closed','completed') THEN 'paid'
             WHEN v_status = 'final_payment' THEN 'partial' ELSE 'sent' END,
        (v_created + interval '35 days')::date, v_created + interval '12 days', v_owner, v_created,
        'Demo invoice');

      IF v_status IN ('final_payment','closed','completed') THEN
        INSERT INTO public.payments (tenant_id, project_id, estimate_id, payment_number, amount,
          status, payment_method, provider_name, customer_email, description, processed_at,
          created_by, created_at, metadata)
        VALUES (v_tenant, v_proj, v_est, 'DEMO-PMT-' || lpad(i::text, 4, '0'),
          CASE WHEN v_status = 'final_payment' THEN round(v_contract * 0.5, 2) ELSE v_contract END,
          'completed'::public.payment_status,
          (ARRAY['check','ach','card'])[1 + (i % 3)], 'stripe',
          'demo.customer' || i || '@example.com', 'Demo payment', v_created + interval '20 days',
          v_owner, v_created, jsonb_build_object('is_demo', true));
      END IF;

      -- Commissions
      IF v_rep = v_rep1 THEN
        v_ctype := 'profit_split'; v_crate := 45; v_camt := round(v_net * 0.45, 2);
      ELSE
        v_ctype := 'percentage_selling_price';
        v_crate := CASE WHEN v_rep = v_rep2 THEN 10 ELSE 8 END;
        v_camt := round(v_contract * (v_crate / 100.0), 2);
      END IF;

      INSERT INTO public.commission_earnings (tenant_id, user_id, project_id, pipeline_entry_id,
        estimate_id, customer_name, job_address, closed_date, contract_value, actual_material_cost,
        actual_labor_cost, gross_profit, rep_overhead_rate, rep_overhead_amount, net_profit,
        commission_type, commission_rate, commission_amount, status, approved_by, approved_at,
        paid_at, notes, created_at)
      VALUES (v_tenant, v_rep, v_proj, v_lead, v_est,
        v_first[1 + (i % 10)] || ' ' || v_last[1 + ((i / 3) % 10)],
        (1000 + i * 7) || ' ' || v_streets[1 + (i % 10)] || ', ' || v_cities[1 + (i % 5)] || ', FL',
        (v_created + interval '24 days')::date, v_contract, round(v_mat * 1.03, 2),
        round(v_lab * 0.97, 2), v_gross, 8, v_oh, v_net, v_ctype, v_crate, v_camt,
        CASE WHEN v_status IN ('closed','completed') THEN 'paid'
             WHEN v_status = 'final_payment' THEN 'approved' ELSE 'pending' END,
        CASE WHEN v_status IN ('final_payment','closed','completed') THEN v_owner END,
        CASE WHEN v_status IN ('final_payment','closed','completed') THEN v_created + interval '25 days' END,
        CASE WHEN v_status IN ('closed','completed') THEN v_created + interval '30 days' END,
        'Demo commission record', v_created);
    END IF;
  END LOOP;
END $$;