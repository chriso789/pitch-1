-- ============================================================
-- Scope Network Enhancement: Auto-Processing & Line Item Search
-- ============================================================

-- 1. Create trigger to auto-process insurance documents into scope pipeline
CREATE OR REPLACE FUNCTION process_insurance_document_to_scope()
RETURNS TRIGGER AS $$
BEGIN
  -- Only trigger for insurance documents with PDF files
  IF NEW.document_type = 'insurance' 
     AND NEW.file_path LIKE '%.pdf' THEN
    
    -- Check if not already processed
    IF NOT EXISTS (
      SELECT 1 FROM insurance_scope_documents 
      WHERE source_document_id = NEW.id
         OR (storage_path = NEW.file_path AND tenant_id = NEW.tenant_id)
    ) THEN
      -- Insert pending scope document for processing
      INSERT INTO insurance_scope_documents (
        tenant_id,
        source_document_id,
        document_type,
        file_name,
        file_hash,
        file_size_bytes,
        storage_path,
        parse_status,
        created_by
      ) VALUES (
        NEW.tenant_id,
        NEW.id,
        'estimate',
        NEW.filename,
        md5(NEW.file_path),
        NEW.file_size,
        NEW.file_path,
        'pending',
        NEW.uploaded_by
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create the trigger
DROP TRIGGER IF EXISTS auto_process_insurance_docs ON documents;
CREATE TRIGGER auto_process_insurance_docs
  AFTER INSERT ON documents
  FOR EACH ROW
  EXECUTE FUNCTION process_insurance_document_to_scope();

-- 2. Create view for anonymized network line items (for cross-tenant search)
CREATE OR REPLACE VIEW scope_network_line_items AS
SELECT 
  li.id,
  li.raw_code,
  li.raw_description,
  li.raw_category,
  li.unit,
  li.unit_price,
  li.quantity,
  li.total_rcv,
  li.total_acv,
  d.carrier_normalized,
  md5(d.tenant_id::text) as contributor_hash,
  h.property_state as state_code,
  LEFT(h.property_zip, 3) as zip_prefix,
  d.created_at
FROM insurance_scope_line_items li
JOIN insurance_scope_headers h ON li.header_id = h.id
JOIN insurance_scope_documents d ON h.document_id = d.id
WHERE d.parse_status = 'complete'
  AND li.raw_description IS NOT NULL
  AND li.raw_description != '';

-- 3. Create RPC function for network line item search (bypasses RLS for cross-tenant)
CREATE OR REPLACE FUNCTION search_network_line_items(
  p_search TEXT DEFAULT NULL,
  p_carrier TEXT DEFAULT NULL,
  p_category TEXT DEFAULT NULL,
  p_unit TEXT DEFAULT NULL,
  p_min_price NUMERIC DEFAULT NULL,
  p_max_price NUMERIC DEFAULT NULL,
  p_limit INTEGER DEFAULT 100,
  p_offset INTEGER DEFAULT 0
)
RETURNS TABLE (
  id UUID,
  raw_code TEXT,
  raw_description TEXT,
  raw_category TEXT,
  unit TEXT,
  unit_price NUMERIC,
  total_rcv NUMERIC,
  carrier_normalized TEXT,
  contributor_hash TEXT,
  state_code TEXT,
  network_frequency INTEGER,
  avg_price NUMERIC,
  min_price NUMERIC,
  max_price NUMERIC
) 
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  WITH filtered_items AS (
    SELECT 
      nli.id,
      nli.raw_code,
      nli.raw_description,
      nli.raw_category,
      nli.unit,
      nli.unit_price,
      nli.total_rcv,
      nli.carrier_normalized,
      nli.contributor_hash,
      nli.state_code
    FROM scope_network_line_items nli
    WHERE 
      (p_search IS NULL OR nli.raw_description ILIKE '%' || p_search || '%' OR nli.raw_code ILIKE '%' || p_search || '%')
      AND (p_carrier IS NULL OR nli.carrier_normalized = p_carrier)
      AND (p_category IS NULL OR nli.raw_category ILIKE '%' || p_category || '%')
      AND (p_unit IS NULL OR nli.unit = p_unit)
      AND (p_min_price IS NULL OR nli.unit_price >= p_min_price)
      AND (p_max_price IS NULL OR nli.unit_price <= p_max_price)
  ),
  price_stats AS (
    SELECT 
      LOWER(fi.raw_description) as desc_key,
      COUNT(*)::INTEGER as frequency,
      AVG(fi.unit_price) as avg_unit_price,
      MIN(fi.unit_price) as min_unit_price,
      MAX(fi.unit_price) as max_unit_price
    FROM filtered_items fi
    WHERE fi.unit_price IS NOT NULL
    GROUP BY LOWER(fi.raw_description)
  )
  SELECT DISTINCT ON (fi.id)
    fi.id,
    fi.raw_code,
    fi.raw_description,
    fi.raw_category,
    fi.unit,
    fi.unit_price,
    fi.total_rcv,
    fi.carrier_normalized,
    fi.contributor_hash,
    fi.state_code,
    COALESCE(ps.frequency, 1) as network_frequency,
    COALESCE(ps.avg_unit_price, fi.unit_price) as avg_price,
    COALESCE(ps.min_unit_price, fi.unit_price) as min_price,
    COALESCE(ps.max_unit_price, fi.unit_price) as max_price
  FROM filtered_items fi
  LEFT JOIN price_stats ps ON LOWER(fi.raw_description) = ps.desc_key
  ORDER BY fi.id, ps.frequency DESC NULLS LAST
  LIMIT p_limit
  OFFSET p_offset;
END;
$$;

-- 4. Create RPC function for comparison analysis
CREATE OR REPLACE FUNCTION analyze_scope_comparison(
  p_document_id UUID,
  p_carrier_filter TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_result JSON;
  v_document_carrier TEXT;
  v_document_state TEXT;
  v_total_items INTEGER;
  v_total_rcv NUMERIC;
BEGIN
  -- Get the document's carrier and summary
  SELECT 
    d.carrier_normalized,
    h.property_state,
    COUNT(li.id),
    COALESCE(SUM(li.total_rcv), 0)
  INTO v_document_carrier, v_document_state, v_total_items, v_total_rcv
  FROM insurance_scope_documents d
  JOIN insurance_scope_headers h ON h.document_id = d.id
  JOIN insurance_scope_line_items li ON li.header_id = h.id
  WHERE d.id = p_document_id
  GROUP BY d.carrier_normalized, h.property_state;

  -- Use document carrier if no filter specified
  IF p_carrier_filter IS NULL THEN
    p_carrier_filter := v_document_carrier;
  END IF;

  -- Build the comparison result
  WITH document_items AS (
    SELECT 
      li.id as line_item_id,
      li.raw_code,
      li.raw_description,
      li.unit,
      li.unit_price,
      li.total_rcv
    FROM insurance_scope_line_items li
    JOIN insurance_scope_headers h ON li.header_id = h.id
    WHERE h.document_id = p_document_id
  ),
  network_items AS (
    SELECT 
      LOWER(nli.raw_description) as desc_key,
      nli.raw_code,
      nli.raw_description,
      nli.unit,
      AVG(nli.unit_price) as avg_price,
      COUNT(DISTINCT nli.contributor_hash)::NUMERIC / 
        NULLIF((SELECT COUNT(DISTINCT contributor_hash) FROM scope_network_line_items WHERE carrier_normalized = p_carrier_filter), 0) as paid_rate,
      COUNT(*) as sample_count
    FROM scope_network_line_items nli
    WHERE (p_carrier_filter IS NULL OR nli.carrier_normalized = p_carrier_filter)
    GROUP BY LOWER(nli.raw_description), nli.raw_code, nli.raw_description, nli.unit
    HAVING COUNT(*) >= 2  -- Only items that appear multiple times
  ),
  matched AS (
    SELECT 
      di.line_item_id,
      di.raw_description as description,
      di.unit_price,
      ni.avg_price as network_avg_price,
      COALESCE(ni.paid_rate, 0) as network_frequency
    FROM document_items di
    JOIN network_items ni ON LOWER(di.raw_description) = ni.desc_key
  ),
  missing AS (
    SELECT 
      ni.desc_key as canonical_key,
      ni.raw_description as description,
      ni.raw_code,
      ni.unit,
      ni.avg_price as suggested_unit_price,
      COALESCE(ni.paid_rate, 0) as network_paid_rate,
      ni.sample_count as network_sample_count
    FROM network_items ni
    WHERE NOT EXISTS (
      SELECT 1 FROM document_items di 
      WHERE LOWER(di.raw_description) = ni.desc_key
    )
    AND ni.paid_rate > 0.3  -- Only items paid in >30% of scopes
    ORDER BY ni.paid_rate DESC
    LIMIT 20
  ),
  discrepancies AS (
    SELECT 
      m.line_item_id,
      m.description,
      m.unit_price as scope_price,
      m.network_avg_price,
      CASE 
        WHEN m.network_avg_price > 0 
        THEN ((m.unit_price - m.network_avg_price) / m.network_avg_price * 100)
        ELSE 0
      END as difference_percent
    FROM matched m
    WHERE m.network_avg_price > 0
      AND ABS(m.unit_price - m.network_avg_price) / m.network_avg_price > 0.1  -- >10% difference
  )
  SELECT json_build_object(
    'scope_summary', json_build_object(
      'total_items', v_total_items,
      'total_rcv', v_total_rcv,
      'carrier_detected', v_document_carrier,
      'state_detected', v_document_state
    ),
    'matched_items', (SELECT COALESCE(json_agg(m.*), '[]'::json) FROM matched m),
    'missing_items', (SELECT COALESCE(json_agg(mi.*), '[]'::json) FROM missing mi),
    'price_discrepancies', (SELECT COALESCE(json_agg(d.*), '[]'::json) FROM discrepancies d)
  ) INTO v_result;

  RETURN v_result;
END;
$$;