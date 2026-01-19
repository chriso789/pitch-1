// ============================================
// PERMIT LINK APPROVALS Edge Function
// POST /functions/v1/permit_link_approvals
// Links products from estimate to approval documents
// ============================================

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { z } from 'https://deno.land/x/zod@v3.23.8/mod.ts';

import { supabaseAuth, getAuthUser, supabaseService } from '../_shared/supabase.ts';
import { jsonOK, jsonErr, handleCors } from '../_shared/response.ts';
import type { MissingItem } from '../_shared/permit_types.ts';
import { MISSING_ITEM_KEYS } from '../_shared/permit_types.ts';

const ReqSchema = z.object({
  estimate_id: z.string().uuid(),
  options: z.object({
    auto_download_docs: z.boolean().optional(),
    auto_extract_fields: z.boolean().optional(),
  }).optional(),
});

interface LinkedApproval {
  product_id: string;
  approval_kind: string;
  approval_number: string;
  doc_id: string;
}

serve(async (req) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  try {
    if (req.method !== 'POST') {
      return jsonErr(405, 'METHOD_NOT_ALLOWED', 'Use POST');
    }

    const body = await req.json().catch(() => null);
    const parsed = ReqSchema.safeParse(body);
    if (!parsed.success) {
      return jsonErr(400, 'INVALID_REQUEST', 'Invalid payload', {
        issues: parsed.error.issues,
      });
    }

    const { estimate_id, options } = parsed.data;

    // Authenticate
    const sb = supabaseAuth(req);
    const user = await getAuthUser(sb);
    
    if (!user) {
      return jsonErr(401, 'UNAUTHORIZED', 'Authentication required');
    }

    const tenantId = user.tenantId;
    if (!tenantId) {
      return jsonErr(403, 'FORBIDDEN', 'No active company found');
    }

    const adminSb = supabaseService();

    // Get estimate line items
    const { data: estimate, error: estErr } = await adminSb
      .from('estimates')
      .select('id, tenant_id')
      .eq('id', estimate_id)
      .eq('tenant_id', tenantId)
      .single();

    if (estErr || !estimate) {
      return jsonErr(404, 'NOT_FOUND', 'Estimate not found');
    }

    // Get estimate line items that should map to products
    const { data: lineItems, error: liErr } = await adminSb
      .from('estimate_line_items')
      .select('*')
      .eq('estimate_id', estimate_id);

    if (liErr) {
      return jsonErr(500, 'INTERNAL_ERROR', `Failed to fetch line items: ${liErr.message}`);
    }

    const linked: LinkedApproval[] = [];
    const missing_items: MissingItem[] = [];

    // Check if we have product mappings
    const roofingLineItems = (lineItems || []).filter(li => 
      li.category?.toLowerCase().includes('roof') ||
      li.item_type === 'material'
    );

    if (roofingLineItems.length === 0) {
      missing_items.push({
        key: MISSING_ITEM_KEYS.PRODUCT_MAPPING_PRIMARY,
        severity: 'error',
        message: 'No roofing products found in estimate line items.',
      });
    }

    // TODO: Implement actual product linking logic:
    // 1. For each roofing line item, check if it has a product_id reference
    // 2. If not, try to match by name/SKU to products table
    // 3. For each matched product, get/download approval documents
    // 4. Extract fields from approval PDFs if auto_extract_fields is true

    // For now, return what we have
    for (const li of roofingLineItems) {
      if (li.product_id) {
        // Get approval documents for this product
        const { data: approvals } = await adminSb
          .from('product_approval_documents')
          .select('*')
          .eq('product_id', li.product_id)
          .eq('tenant_id', tenantId);

        for (const approval of approvals || []) {
          linked.push({
            product_id: li.product_id,
            approval_kind: approval.approval_kind,
            approval_number: approval.approval_number,
            doc_id: approval.id,
          });
        }

        if (!approvals || approvals.length === 0) {
          missing_items.push({
            key: MISSING_ITEM_KEYS.PRODUCT_APPROVAL_PRIMARY,
            severity: 'warning',
            message: `Product ${li.description || li.product_id} has no approval documents linked.`,
          });
        }
      }
    }

    // Check for primary product
    const hasPrimaryMapping = roofingLineItems.some(li => li.product_id && li.is_primary);
    if (!hasPrimaryMapping && roofingLineItems.length > 0) {
      missing_items.push({
        key: MISSING_ITEM_KEYS.PRODUCT_MAPPING_PRIMARY,
        severity: 'warning',
        message: 'No primary roof system product is designated.',
      });
    }

    return jsonOK({
      estimate_id,
      linked,
      missing_items,
    });
  } catch (e: any) {
    console.error('permit_link_approvals error:', e);
    return jsonErr(500, 'INTERNAL_ERROR', e?.message ?? 'Unknown error');
  }
});
