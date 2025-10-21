-- Add SRS item code support to products table
ALTER TABLE public.products 
ADD COLUMN IF NOT EXISTS srs_item_code TEXT,
ADD COLUMN IF NOT EXISTS vendor_id UUID REFERENCES public.vendors(id);

CREATE INDEX IF NOT EXISTS idx_products_srs_item_code ON public.products(srs_item_code) WHERE srs_item_code IS NOT NULL;

-- Add SRS item code to purchase_order_items
ALTER TABLE public.purchase_order_items
ADD COLUMN IF NOT EXISTS srs_item_code TEXT,
ADD COLUMN IF NOT EXISTS item_description TEXT;

-- Add SRS item code to estimate_line_items  
ALTER TABLE public.estimate_line_items
ADD COLUMN IF NOT EXISTS srs_item_code TEXT,
ADD COLUMN IF NOT EXISTS vendor_id UUID REFERENCES public.vendors(id);

CREATE INDEX IF NOT EXISTS idx_estimate_line_items_srs_code ON public.estimate_line_items(srs_item_code) WHERE srs_item_code IS NOT NULL;

-- Create function to generate PO numbers
CREATE OR REPLACE FUNCTION generate_po_number()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    next_num INTEGER;
    po_num TEXT;
BEGIN
    SELECT COALESCE(MAX(SUBSTRING(po_number FROM '[0-9]+')::INTEGER), 0) + 1 
    INTO next_num
    FROM public.purchase_orders 
    WHERE tenant_id = get_user_tenant_id();
    
    po_num := 'PO-' || LPAD(next_num::TEXT, 6, '0');
    RETURN po_num;
END;
$$;

-- Create function to create material order from estimate
CREATE OR REPLACE FUNCTION api_create_material_order_from_estimate(
    p_estimate_id UUID,
    p_vendor_id UUID,
    p_delivery_address JSONB DEFAULT NULL,
    p_branch_code TEXT DEFAULT NULL,
    p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_order_id UUID;
    v_tenant_id UUID;
    v_po_number TEXT;
    v_project_id UUID;
    v_line_item RECORD;
    v_subtotal NUMERIC := 0;
    v_freight NUMERIC := 75.00;
BEGIN
    -- Get tenant and project from estimate
    SELECT e.tenant_id, e.project_id
    INTO v_tenant_id, v_project_id
    FROM public.estimates e
    WHERE e.id = p_estimate_id AND e.tenant_id = get_user_tenant_id();
    
    IF v_tenant_id IS NULL THEN
        RAISE EXCEPTION 'Estimate not found or access denied';
    END IF;
    
    -- Generate PO number
    v_po_number := generate_po_number();
    
    -- Create purchase order
    INSERT INTO public.purchase_orders (
        tenant_id,
        po_number,
        vendor_id,
        project_id,
        branch_code,
        status,
        order_date,
        delivery_address,
        notes,
        shipping_amount,
        created_by
    ) VALUES (
        v_tenant_id,
        v_po_number,
        p_vendor_id,
        v_project_id,
        p_branch_code,
        'draft',
        CURRENT_DATE,
        p_delivery_address,
        p_notes,
        v_freight,
        auth.uid()
    ) RETURNING id INTO v_order_id;
    
    -- Add line items from estimate
    FOR v_line_item IN
        SELECT 
            eli.id,
            eli.material_id,
            eli.item_name,
            eli.description,
            eli.quantity,
            eli.unit_type,
            eli.unit_cost,
            eli.extended_cost,
            eli.srs_item_code,
            p.id as product_id
        FROM public.estimate_line_items eli
        LEFT JOIN public.products p ON p.id = eli.material_id
        WHERE eli.estimate_id = p_estimate_id
        AND eli.item_category = 'material'
        AND eli.quantity > 0
        ORDER BY eli.sort_order
    LOOP
        INSERT INTO public.purchase_order_items (
            tenant_id,
            po_id,
            product_id,
            srs_item_code,
            item_description,
            quantity,
            unit_price,
            line_total,
            metadata
        ) VALUES (
            v_tenant_id,
            v_order_id,
            v_line_item.product_id,
            v_line_item.srs_item_code,
            v_line_item.item_name || COALESCE(' - ' || v_line_item.description, ''),
            v_line_item.quantity::INTEGER,
            v_line_item.unit_cost,
            v_line_item.extended_cost,
            jsonb_build_object(
                'estimate_line_item_id', v_line_item.id,
                'unit_type', v_line_item.unit_type
            )
        );
        
        v_subtotal := v_subtotal + v_line_item.extended_cost;
    END LOOP;
    
    -- Update totals
    UPDATE public.purchase_orders
    SET subtotal = v_subtotal,
        total_amount = v_subtotal + v_freight
    WHERE id = v_order_id;
    
    RETURN v_order_id;
END;
$$;