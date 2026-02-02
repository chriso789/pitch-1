-- ============================================================
-- Scope Network Intelligence: Cross-Tenant Anonymized View
-- Aggregates scope data across ALL tenants with PII redaction
-- ============================================================

-- Create the cross-tenant view with PII redaction
-- Note: Views don't have RLS, so we use edge functions with service role for access control
CREATE OR REPLACE VIEW scope_network_intelligence AS
SELECT 
  -- Document metadata (no direct tenant identifier)
  d.id as document_id,
  md5(d.tenant_id::text) as contributor_hash,
  d.document_type,
  d.carrier_normalized,
  d.format_family,
  d.parse_status,
  EXTRACT(YEAR FROM d.loss_date_detected::date) as loss_year,
  EXTRACT(MONTH FROM d.loss_date_detected::date) as loss_month,
  d.created_at,
  
  -- Header totals (no PII)
  h.total_rcv,
  h.total_acv,
  h.total_depreciation,
  h.recoverable_depreciation,
  h.non_recoverable_depreciation,
  h.deductible,
  h.tax_amount,
  h.overhead_amount,
  h.profit_amount,
  h.total_net_claim,
  
  -- Redacted location (state + ZIP prefix only)
  h.property_state as state_code,
  LEFT(h.property_zip, 3) as zip_prefix,
  
  -- Price list info (useful for industry comparisons)
  h.price_list_name,
  h.price_list_region,
  
  -- Line item count for this document
  (
    SELECT COUNT(*)::int 
    FROM insurance_scope_line_items li 
    WHERE li.header_id = h.id
  ) as line_item_count

FROM insurance_scope_documents d
LEFT JOIN insurance_scope_headers h ON h.document_id = d.id
WHERE d.parse_status = 'complete';

-- Grant SELECT to authenticated users (access via edge function only recommended)
GRANT SELECT ON scope_network_intelligence TO authenticated;

-- Create a helper function to get network stats (used by edge function)
CREATE OR REPLACE FUNCTION get_scope_network_stats()
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result JSON;
BEGIN
  SELECT json_build_object(
    'total_documents', (SELECT COUNT(*) FROM insurance_scope_documents WHERE parse_status = 'complete'),
    'total_contributors', (SELECT COUNT(DISTINCT tenant_id) FROM insurance_scope_documents WHERE parse_status = 'complete'),
    'total_line_items', (SELECT COUNT(*) FROM insurance_scope_line_items li JOIN insurance_scope_headers h ON li.header_id = h.id JOIN insurance_scope_documents d ON h.document_id = d.id WHERE d.parse_status = 'complete'),
    'carrier_distribution', (
      SELECT json_agg(json_build_object('carrier', carrier_normalized, 'count', cnt))
      FROM (
        SELECT carrier_normalized, COUNT(*) as cnt
        FROM insurance_scope_documents
        WHERE parse_status = 'complete' AND carrier_normalized IS NOT NULL
        GROUP BY carrier_normalized
        ORDER BY cnt DESC
        LIMIT 10
      ) sub
    ),
    'state_distribution', (
      SELECT json_agg(json_build_object('state', state_code, 'count', cnt))
      FROM (
        SELECT h.property_state as state_code, COUNT(*) as cnt
        FROM insurance_scope_headers h
        JOIN insurance_scope_documents d ON h.document_id = d.id
        WHERE d.parse_status = 'complete' AND h.property_state IS NOT NULL
        GROUP BY h.property_state
        ORDER BY cnt DESC
        LIMIT 15
      ) sub
    ),
    'total_rcv_sum', (
      SELECT COALESCE(SUM(h.total_rcv), 0)
      FROM insurance_scope_headers h
      JOIN insurance_scope_documents d ON h.document_id = d.id
      WHERE d.parse_status = 'complete'
    ),
    'avg_rcv', (
      SELECT COALESCE(AVG(h.total_rcv), 0)
      FROM insurance_scope_headers h
      JOIN insurance_scope_documents d ON h.document_id = d.id
      WHERE d.parse_status = 'complete' AND h.total_rcv > 0
    ),
    'monthly_trend', (
      SELECT json_agg(json_build_object('month', month, 'count', cnt))
      FROM (
        SELECT TO_CHAR(created_at, 'YYYY-MM') as month, COUNT(*) as cnt
        FROM insurance_scope_documents
        WHERE parse_status = 'complete' AND created_at >= NOW() - INTERVAL '6 months'
        GROUP BY TO_CHAR(created_at, 'YYYY-MM')
        ORDER BY month DESC
      ) sub
    )
  ) INTO result;
  
  RETURN result;
END;
$$;