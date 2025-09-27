-- Fix security warnings by setting proper search paths on functions
-- This addresses the Function Search Path Mutable warnings

-- Fix the search paths for all functions that are missing them
ALTER FUNCTION public.update_budget_calculations() SET search_path = public;
ALTER FUNCTION public.update_lead_approval_requirements() SET search_path = public;
ALTER FUNCTION public.auto_assign_pipeline_entry() SET search_path = public;
ALTER FUNCTION public.check_enrollment_eligibility(jsonb, jsonb) SET search_path = public;
ALTER FUNCTION public.check_budget_variance_alerts() SET search_path = public;
ALTER FUNCTION public.process_smart_words(text, jsonb, uuid) SET search_path = public;
ALTER FUNCTION public.auto_assign_contact_number() SET search_path = public;
ALTER FUNCTION public.auto_assign_job_number() SET search_path = public;
ALTER FUNCTION public.create_production_workflow() SET search_path = public;
ALTER FUNCTION public.validate_production_stage_transition() SET search_path = public;
ALTER FUNCTION public.calculate_enhanced_estimate(uuid) SET search_path = public;
ALTER FUNCTION public.recalculate_estimate_on_line_item_change() SET search_path = public;
ALTER FUNCTION public.auto_create_rep_commission_plan() SET search_path = public;
ALTER FUNCTION public.calculate_enhanced_rep_commission(uuid, uuid) SET search_path = public;
ALTER FUNCTION public.detect_contact_duplicates() SET search_path = public;
ALTER FUNCTION public.soft_delete_contact(uuid) SET search_path = public;
ALTER FUNCTION public.check_location_radius(jsonb, numeric, numeric, numeric) SET search_path = public;
ALTER FUNCTION public.log_ghost_account_activity() SET search_path = public;
ALTER FUNCTION public.create_estimate_version() SET search_path = public;
ALTER FUNCTION public.handle_new_user() SET search_path = public;

-- Add proper search path to immutable utility functions
ALTER FUNCTION public.normalize_phone(text) SET search_path = public;
ALTER FUNCTION public.normalize_email(text) SET search_path = public;
ALTER FUNCTION public.calculate_name_similarity(text, text) SET search_path = public;

-- Make sure all the role checking functions have proper search paths
ALTER FUNCTION public.has_role(app_role) SET search_path = public;
ALTER FUNCTION public.has_any_role(app_role[]) SET search_path = public;