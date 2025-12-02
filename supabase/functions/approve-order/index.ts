import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { corsHeaders } from '../_shared/cors.ts';

interface ApprovalAction {
  approval_id: string;
  action: 'approve' | 'reject';
  comments?: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ========== AUTHENTICATION ==========
    // Extract and verify the authenticated user from JWT
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      console.error('Missing Authorization header');
      return new Response(
        JSON.stringify({ success: false, error: 'Authorization header required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create auth client to verify JWT and get user
    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    );

    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (authError || !user) {
      console.error('Auth verification failed:', authError);
      return new Response(
        JSON.stringify({ success: false, error: 'Invalid or expired authentication token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Use authenticated user ID as the approver - NEVER trust request body
    const approver_id = user.id;
    console.log('Authenticated user for approval:', approver_id);

    // Service role client for database operations
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // ========== INPUT VALIDATION ==========
    const { approval_id, action, comments }: ApprovalAction = await req.json();
    console.log('Processing approval action:', { approval_id, action, approver_id });

    if (!approval_id || !action) {
      return new Response(
        JSON.stringify({ success: false, error: 'Approval ID and action are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!['approve', 'reject'].includes(action)) {
      return new Response(
        JSON.stringify({ success: false, error: 'Action must be either "approve" or "reject"' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ========== AUTHORIZATION ==========
    // Get the approval record
    const { data: approval, error: approvalError } = await supabase
      .from('purchase_order_approvals')
      .select('*, purchase_orders(id, tenant_id, total_amount, status, po_number)')
      .eq('id', approval_id)
      .single();

    if (approvalError) throw approvalError;
    if (!approval) {
      return new Response(
        JSON.stringify({ success: false, error: 'Approval request not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify the authenticated user is authorized to approve
    // Check 1: Is the user the specific required approver?
    let isAuthorized = approval.required_approver_id === approver_id;

    // Check 2: Does the user have the required approver role?
    if (!isAuthorized && approval.required_approver_role) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('role, tenant_id')
        .eq('id', approver_id)
        .single();

      if (profile) {
        // Must be same tenant AND have the required role
        isAuthorized = profile.tenant_id === approval.purchase_orders.tenant_id &&
                       profile.role === approval.required_approver_role;
      }
    }

    if (!isAuthorized) {
      console.warn(`Unauthorized approval attempt by user ${approver_id} for approval ${approval_id}`);
      return new Response(
        JSON.stringify({ success: false, error: 'You are not authorized to approve this request' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Check if already responded
    if (approval.status !== 'pending') {
      return new Response(
        JSON.stringify({ success: false, error: `Approval request already ${approval.status}` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const order = approval.purchase_orders;
    const newStatus = action === 'approve' ? 'approved' : 'rejected';

    // ========== PROCESS APPROVAL ==========
    // Update the approval record
    const { error: updateError } = await supabase
      .from('purchase_order_approvals')
      .update({
        status: newStatus,
        approver_id,
        comments,
        responded_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', approval_id);

    if (updateError) throw updateError;

    // Log the action in history
    await supabase
      .from('purchase_order_approval_history')
      .insert({
        tenant_id: order.tenant_id,
        po_id: order.id,
        approval_id,
        action: newStatus,
        actor_id: approver_id,
        comments,
      });

    // Check if all approvals are complete
    const { data: allApprovals } = await supabase
      .from('purchase_order_approvals')
      .select('status')
      .eq('po_id', order.id);

    const hasRejected = allApprovals?.some((a) => a.status === 'rejected');
    const allApproved = allApprovals?.every((a) => a.status === 'approved');
    const hasPending = allApprovals?.some((a) => a.status === 'pending');

    let orderStatus = order.status;
    let message = '';

    if (hasRejected) {
      orderStatus = 'approval_rejected';
      message = 'Order rejected';
    } else if (allApproved) {
      orderStatus = 'approved';
      message = 'Order fully approved';
    } else if (hasPending) {
      orderStatus = 'pending_approval';
      message = action === 'approve' 
        ? 'Approval recorded, waiting for other approvers' 
        : 'Order rejected';
    }

    // Update order status
    await supabase
      .from('purchase_orders')
      .update({ status: orderStatus })
      .eq('id', order.id);

    console.log('Approval processed successfully:', {
      po_number: order.po_number,
      action,
      approver_id,
      new_status: orderStatus,
    });

    return new Response(
      JSON.stringify({
        success: true,
        action: newStatus,
        order_status: orderStatus,
        message,
        all_approved: allApproved,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('Error in approve-order function:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    );
  }
});
