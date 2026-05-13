import { createClient } from "npm:@supabase/supabase-js@2.57.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AssignTaskRequest {
  contact_id: string;
  tenant_id: string;
  assigned_to: string;
  assigned_by: string;
  task_name: string;
  description?: string;
  due_date: string; // ISO timestamp
  priority?: 'low' | 'medium' | 'high' | 'urgent';
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body = await req.json() as AssignTaskRequest;
    const {
      contact_id, tenant_id, assigned_to, assigned_by,
      task_name, description, due_date, priority = 'medium',
    } = body;

    if (!contact_id || !tenant_id || !assigned_to || !task_name || !due_date) {
      return new Response(
        JSON.stringify({ error: 'Missing required fields' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Lookup contact + assignee + assigner
    const [{ data: contact }, { data: assignee }, { data: assigner }] = await Promise.all([
      supabase.from('contacts')
        .select('first_name, last_name, address_street, address_city, address_state, address_zip')
        .eq('id', contact_id).maybeSingle(),
      supabase.from('profiles')
        .select('id, first_name, last_name, email').eq('id', assigned_to).maybeSingle(),
      supabase.from('profiles')
        .select('first_name, last_name, email').eq('id', assigned_by).maybeSingle(),
    ]);

    const contactName = contact
      ? [contact.first_name, contact.last_name].filter(Boolean).join(' ') || 'Contact'
      : 'Contact';
    const contactAddress = contact?.address_street
      ? `${contact.address_street}, ${contact.address_city || ''} ${contact.address_state || ''} ${contact.address_zip || ''}`.trim()
      : '';
    const assignerName = assigner
      ? [assigner.first_name, assigner.last_name].filter(Boolean).join(' ') || assigner.email
      : 'A team member';

    // 1. Create workflow task
    const { data: task, error: taskError } = await supabase
      .from('workflow_tasks')
      .insert({
        tenant_id,
        task_name,
        description: description || null,
        current_phase: 'planning',
        status: 'pending',
        priority,
        assigned_to,
        due_date,
        created_by: assigned_by,
        is_active: true,
        ai_context: { contact_id, assigned_by },
      })
      .select()
      .single();

    if (taskError) {
      console.error('Task insert error:', taskError);
      throw taskError;
    }

    // 2. Create calendar appointment (so it shows up in user's iCal/calendar feed)
    const start = new Date(due_date);
    const end = new Date(start.getTime() + 30 * 60 * 1000);
    const { error: aptError } = await supabase
      .from('appointments')
      .insert({
        tenant_id,
        contact_id,
        assigned_to,
        created_by: assigned_by,
        title: `Task: ${task_name}`,
        appointment_type: 'task',
        scheduled_start: start.toISOString(),
        scheduled_end: end.toISOString(),
        status: 'scheduled',
        address: contactAddress || null,
        notes: description || null,
      });

    if (aptError) console.error('Appointment insert error (non-fatal):', aptError);

    // 3. Create in-app notification
    await supabase.from('user_notifications').insert({
      tenant_id,
      user_id: assigned_to,
      type: 'task_assigned',
      title: `${assignerName} assigned you a task`,
      message: `${task_name} — due ${start.toLocaleString()}`,
      icon: '✅',
      metadata: { task_id: task.id, contact_id, assigned_by },
    }).then(({ error }) => { if (error) console.error('Notification error:', error); });

    // 4. Email the assignee
    if (assignee?.email) {
      const appUrl = Deno.env.get('PUBLIC_APP_URL') || 'https://pitch-crm.ai';
      const dueText = start.toLocaleString('en-US', {
        weekday: 'short', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit',
      });
      try {
        await supabase.functions.invoke('email-send', {
          body: {
            to: [assignee.email],
            subject: `New task assigned: ${task_name}`,
            html: `
              <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
                <h2 style="color: #2563eb;">You have a new task</h2>
                <p><strong>${assignerName}</strong> assigned you a task on contact <strong>${contactName}</strong>${contactAddress ? ` (${contactAddress})` : ''}.</p>
                <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin:16px 0;">
                  <p style="margin:0 0 8px 0;"><strong>Task:</strong> ${task_name}</p>
                  <p style="margin:0 0 8px 0;"><strong>Due:</strong> ${dueText}</p>
                  <p style="margin:0 0 8px 0;"><strong>Priority:</strong> ${priority}</p>
                  ${description ? `<p style="margin:8px 0 0 0;"><strong>Details:</strong><br/>${description.replace(/\n/g, '<br/>')}</p>` : ''}
                </div>
                <p style="color:#6b7280;font-size:13px;">This task has also been added to your calendar feed.</p>
                <a href="${appUrl}/contact/${contact_id}"
                   style="display:inline-block;background:#2563eb;color:white;padding:12px 24px;text-decoration:none;border-radius:6px;margin-top:16px;">
                  View Contact
                </a>
              </div>
            `,
          },
        });
      } catch (e) {
        console.error('Email send error (non-fatal):', e);
      }
    }

    return new Response(
      JSON.stringify({ success: true, task_id: task.id }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('assign-contact-task error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
};

Deno.serve(handler);
