import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { corsHeaders } from '../_shared/cors.ts';

interface ApprovalAction {
  approval_id: string;
  action: 'approve' | 'reject';
  comments?: string;
  approver_id: string;
}

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { approval_id, action, comments, approver_id }: ApprovalAction = await req.json();
    console.log('Processing approval action:', { approval_id, action, approver_id });

    if (!approval_id || !action || !approver_id) {
      throw new Error('Approval ID, action, and approver ID are required');
    }

    if (!['approve', 'reject'].includes(action)) {
      throw new Error('Action must be either "approve" or "reject"');
    }

    // Get the approval record
    const { data: approval, error: approvalError } = await supabase
      .from('purchase_order_approvals')
      .select('*, purchase_orders(id, tenant_id, total_amount, status, po_number)')
      .eq('id', approval_id)
      .single();

    if (approvalError) throw approvalError;
    if (!approval) throw new Error('Approval request not found');

    // Verify the user is authorized to approve
    if (approval.required_approver_id !== approver_id) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', approver_id)
        .single();

      if (!profile || profile.role !== approval.required_approver_role) {
        throw new Error('User is not authorized to approve this request');
      }
    }

    // Check if already responded
    if (approval.status !== 'pending') {
      throw new Error(`Approval request already ${approval.status}`);
    }

    const order = approval.purchase_orders;
    const newStatus = action === 'approve' ? 'approved' : 'rejected';

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

    // Update order status (trigger will also update it, but we do it explicitly here too)
    await supabase
      .from('purchase_orders')
      .update({ status: orderStatus })
      .eq('id', order.id);

    console.log('Approval processed successfully:', {
      po_number: order.po_number,
      action,
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
