import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { corsHeaders } from '../_shared/cors.ts';

interface ApprovalRequest {
  po_id: string;
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

    // Use authenticated user ID as the requester - NEVER trust request body
    const requested_by = user.id;
    console.log('Authenticated user requesting approval:', requested_by);

    // Service role client for database operations
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // ========== INPUT VALIDATION ==========
    const { po_id }: ApprovalRequest = await req.json();
    console.log('Requesting approval for PO:', po_id);

    if (!po_id) {
      return new Response(
        JSON.stringify({ success: false, error: 'Purchase order ID is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ========== AUTHORIZATION ==========
    // Get user's profile to verify tenant access
    const { data: userProfile, error: profileError } = await supabase
      .from('profiles')
      .select('id, tenant_id, role')
      .eq('id', requested_by)
      .single();

    if (profileError || !userProfile) {
      console.error('User profile not found:', profileError);
      return new Response(
        JSON.stringify({ success: false, error: 'User profile not found' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get the purchase order details
    const { data: order, error: orderError } = await supabase
      .from('purchase_orders')
      .select('id, tenant_id, total_amount, status, created_by')
      .eq('id', po_id)
      .single();

    if (orderError) throw orderError;
    if (!order) {
      return new Response(
        JSON.stringify({ success: false, error: 'Purchase order not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify user belongs to the same tenant as the order
    if (userProfile.tenant_id !== order.tenant_id) {
      console.warn(`Cross-tenant approval request attempt by user ${requested_by} for order in tenant ${order.tenant_id}`);
      return new Response(
        JSON.stringify({ success: false, error: 'Access denied' }),
        { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Order total:', order.total_amount);

    // Check if order is in a valid state for approval
    if (!['draft', 'submitted'].includes(order.status)) {
      return new Response(
        JSON.stringify({ success: false, error: `Order cannot be submitted for approval in ${order.status} status` }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ========== DETERMINE APPROVAL REQUIREMENTS ==========
    const { data: rules, error: rulesError } = await supabase
      .rpc('determine_approval_requirements', {
        p_tenant_id: order.tenant_id,
        p_order_amount: order.total_amount,
      });

    if (rulesError) {
      console.error('Error determining approval requirements:', rulesError);
      throw rulesError;
    }

    if (!rules || rules.length === 0) {
      // No approval required, auto-approve
      console.log('No approval rules matched, auto-approving order');
      
      await supabase
        .from('purchase_orders')
        .update({ status: 'approved' })
        .eq('id', po_id);

      await supabase
        .from('purchase_order_approval_history')
        .insert({
          tenant_id: order.tenant_id,
          po_id,
          action: 'approved',
          actor_id: requested_by,
          comments: 'Auto-approved - no approval rules matched',
        });

      return new Response(
        JSON.stringify({
          success: true,
          auto_approved: true,
          message: 'Order auto-approved',
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      );
    }

    const rule = rules[0];
    console.log('Approval rule matched:', rule.rule_name);
    console.log('Required approvers:', rule.required_approvers);

    // Check if approvals already exist
    const { data: existingApprovals } = await supabase
      .from('purchase_order_approvals')
      .select('id')
      .eq('po_id', po_id);

    if (existingApprovals && existingApprovals.length > 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'Approval request already exists for this order' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ========== CREATE APPROVAL REQUESTS ==========
    const approvers = rule.required_approvers as string[];
    const approvalRecords = [];

    for (let i = 0; i < approvers.length; i++) {
      const approver = approvers[i];
      const isUserId = approver.includes('-'); // UUIDs contain dashes

      // If it's a role, we'll need to find users with that role
      if (!isUserId) {
        // Get users with this role
        const { data: usersWithRole, error: usersError } = await supabase
          .from('profiles')
          .select('id')
          .eq('tenant_id', order.tenant_id)
          .eq('role', approver)
          .limit(10);

        if (usersError) {
          console.error('Error finding users with role:', usersError);
          continue;
        }

        if (usersWithRole && usersWithRole.length > 0) {
          // Create approval request for each user with the role
          for (const roleUser of usersWithRole) {
            approvalRecords.push({
              tenant_id: order.tenant_id,
              po_id,
              rule_id: rule.rule_id,
              required_approver_id: roleUser.id,
              required_approver_role: approver,
              status: 'pending',
              approval_level: i + 1,
            });
          }
        }
      } else {
        // Direct user ID
        approvalRecords.push({
          tenant_id: order.tenant_id,
          po_id,
          rule_id: rule.rule_id,
          required_approver_id: approver,
          status: 'pending',
          approval_level: i + 1,
        });
      }
    }

    if (approvalRecords.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'No approvers found for the approval rule' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Insert approval requests
    const { error: approvalError } = await supabase
      .from('purchase_order_approvals')
      .insert(approvalRecords);

    if (approvalError) throw approvalError;

    // Update order status to pending_approval
    await supabase
      .from('purchase_orders')
      .update({ status: 'pending_approval' })
      .eq('id', po_id);

    // Log approval request in history
    await supabase
      .from('purchase_order_approval_history')
      .insert({
        tenant_id: order.tenant_id,
        po_id,
        action: 'requested',
        actor_id: requested_by,
        metadata: {
          rule_name: rule.rule_name,
          approvers_count: approvalRecords.length,
        },
      });

    console.log(`Created ${approvalRecords.length} approval requests by user ${requested_by}`);

    return new Response(
      JSON.stringify({
        success: true,
        approvals_required: approvalRecords.length,
        rule_name: rule.rule_name,
        message: `Approval request sent to ${approvalRecords.length} approver(s)`,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('Error in request-order-approval function:', error);
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
