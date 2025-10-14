-- Bootstrap initial workflow task for comprehensive button audit
DO $$
DECLARE
  v_tenant_id uuid;
BEGIN
  -- Get first admin/master tenant_id
  SELECT tenant_id INTO v_tenant_id
  FROM profiles
  WHERE role IN ('admin', 'master')
  LIMIT 1;

  -- Only insert if we found a tenant
  IF v_tenant_id IS NOT NULL THEN
    INSERT INTO workflow_tasks (
      tenant_id,
      task_name,
      description,
      current_phase,
      completion_criteria,
      ai_context
    ) VALUES (
      v_tenant_id,
      'Complete Button Pathway Validation',
      'AI-driven comprehensive audit of all button implementations across the application. Analyzes onClick handlers, error handling, loading states, accessibility, and user feedback patterns.',
      'planning',
      '{"audit_complete": true, "critical_issues_resolved": true, "files_audited": 87, "min_success_rate": 0.95}'::jsonb,
      jsonb_build_object(
        'total_files', 87,
        'button_categories', jsonb_build_object(
          'data_mutation', 56,
          'navigation', 24,
          'api_integration', 15,
          'state_management', 5
        ),
        'priority_areas', jsonb_build_array(
          'Database Mutation Buttons',
          'API Integration Buttons',
          'Form Submission Pathways'
        ),
        'completion_percentage', 0,
        'last_ai_update', now()::text
      )
    )
    ON CONFLICT DO NOTHING;
  END IF;
END $$;