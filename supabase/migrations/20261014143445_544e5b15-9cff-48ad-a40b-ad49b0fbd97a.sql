-- 1) Service-only background actions (supplier tokens, dialer counters, SMS blast queue, cleanup jobs)
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure sig FROM pg_proc p WHERE p.pronamespace='public'::regnamespace AND p.proname IN (
    'abc_tokens_get','abc_tokens_upsert','increment_campaign_answered','increment_campaign_attempts','increment_campaign_bridged','update_campaign_avg_talk_time',
    'prune_log_tables','reap_stale_sms_claims','recalc_sms_blast_counts','release_sms_blast_item_rate_limited','claim_sms_blast_items','complete_sms_blast_if_done',
    'seed_labor_order_statuses','sweep_closed_stage_auto_advance','update_cache_access_stats','backfill_clj_numbers','calculate_rep_commission',
    'cleanup_expired_canvass_sessions','cleanup_old_rate_limits')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END $$;

-- 2) Company guards on actions that write prices or read project financials
DO $$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.api_upsert_material(text,text,uuid,uuid,text,numeric,numeric,numeric,text,text,text[],jsonb)'::regprocedure);
  d := regexp_replace(d, '\mBEGIN\M', $g$BEGIN
  IF coalesce(auth.role(),'') <> 'service_role' AND NOT public.has_role(auth.uid(),'master') AND (p_tenant_id IS NULL OR NOT public.user_can_access_tenant(p_tenant_id)) THEN
    RAISE EXCEPTION 'Not allowed to change materials for this company' USING ERRCODE = '42501';
  END IF;$g$);
  EXECUTE d;

  d := pg_get_functiondef('public.api_bulk_import_materials(jsonb)'::regprocedure);
  d := regexp_replace(d, '\mBEGIN\M', $g$BEGIN
  IF coalesce(auth.role(),'') <> 'service_role' AND NOT public.has_role(auth.uid(),'master') THEN
    RAISE EXCEPTION 'Only platform admins can bulk import the shared material catalog' USING ERRCODE = '42501';
  END IF;$g$);
  EXECUTE d;

  d := pg_get_functiondef('public.calculate_enhanced_rep_commission(uuid,uuid)'::regprocedure);
  d := regexp_replace(d, '\mBEGIN\M', $g$BEGIN
  IF coalesce(auth.role(),'') <> 'service_role' AND NOT EXISTS (SELECT 1 FROM public.projects pj WHERE pj.id = project_id_param AND public.user_can_access_tenant(pj.tenant_id)) THEN
    RAISE EXCEPTION 'Project not found for this company' USING ERRCODE = '42501';
  END IF;$g$);
  EXECUTE d;
END $$;