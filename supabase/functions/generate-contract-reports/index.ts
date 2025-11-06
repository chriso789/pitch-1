import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ReportRequest {
  report_type: 'status' | 'tracking' | 'volume';
  from?: string;
  to?: string;
  recipients?: string[];
  subject?: string;
  message?: string;
  send_email?: boolean;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('Generate contract reports - Request received');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const edgeBase = Deno.env.get('EDGE_BASE') || supabaseUrl.replace('.supabase.co', '.functions.supabase.co');
    const companyName = Deno.env.get('COMPANY_NAME') || 'CRM System';

    const supabase = createClient(supabaseUrl, supabaseKey);
    const body: ReportRequest = await req.json();
    
    // Determine date range (default last 30 days)
    const today = new Date();
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(today.getDate() - 30);
    
    const from = body.from || thirtyDaysAgo.toISOString().split('T')[0];
    const to = body.to || today.toISOString().split('T')[0];
    
    console.log(`Report type: ${body.report_type}, Date range: ${from} to ${to}`);
    
    // Generate HTML based on report type
    let html: string;
    let filename: string;
    
    switch (body.report_type) {
      case 'status':
        html = await generateStatusReport(supabase, from, to, companyName);
        filename = `contract_status_${from}_${to}.pdf`;
        break;
      case 'tracking':
        html = await generateTrackingReport(supabase, from, to, companyName);
        filename = `contract_tracking_${from}_${to}.pdf`;
        break;
      case 'volume':
        html = await generateVolumeReport(supabase, from, to, companyName);
        filename = `contract_volume_${from}_${to}.pdf`;
        break;
      default:
        throw new Error(`Invalid report type: ${body.report_type}`);
    }
    
    console.log('Calling smart-docs-pdf function');
    
    // Generate PDF via smart-docs-pdf
    const pdfResponse = await fetch(`${edgeBase}/smart-docs-pdf`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': req.headers.get('Authorization') || '',
      },
      body: JSON.stringify({
        html,
        upload: 'signed',
        filename
      })
    });
    
    if (!pdfResponse.ok) {
      const errorText = await pdfResponse.text();
      throw new Error(`PDF generation failed: ${errorText}`);
    }
    
    const pdfData = await pdfResponse.json();
    console.log('PDF generated successfully:', pdfData.pdf_url);
    
    // Send email if requested
    let emailResults = [];
    if (body.send_email && body.recipients && body.recipients.length > 0) {
      const subject = body.subject || `Contract ${body.report_type.charAt(0).toUpperCase() + body.report_type.slice(1)} Report: ${from} to ${to}`;
      const emailBody = `${body.message || 'Your contract report is ready.'}\n\nView Report: ${pdfData.pdf_url}\n\nNote: This link will expire in 7 days.`;
      
      console.log(`Sending emails to ${body.recipients.length} recipient(s)`);
      
      for (const recipient of body.recipients) {
        try {
          const emailResponse = await fetch(`${edgeBase}/send-email`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': req.headers.get('Authorization') || '',
            },
            body: JSON.stringify({
              to: [recipient.trim()],
              subject,
              body: emailBody
            })
          });
          
          if (emailResponse.ok) {
            console.log(`Email sent successfully to ${recipient}`);
            emailResults.push({ recipient, success: true });
          } else {
            const errorText = await emailResponse.text();
            console.error(`Failed to send email to ${recipient}:`, errorText);
            emailResults.push({ recipient, success: false, error: errorText });
          }
        } catch (error) {
          console.error(`Error sending email to ${recipient}:`, error);
          emailResults.push({ recipient, success: false, error: String(error) });
        }
      }
    }
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        pdf_url: pdfData.pdf_url,
        report_type: body.report_type,
        date_range: { from, to },
        email_results: emailResults
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );
    
  } catch (error) {
    console.error('Report generation error:', error);
    return new Response(
      JSON.stringify({ 
        error: String(error),
        message: error instanceof Error ? error.message : 'Unknown error'
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});

async function generateStatusReport(supabase: any, from: string, to: string, companyName: string): Promise<string> {
  const { data: envelopes, error } = await supabase
    .from('signature_envelopes')
    .select('*')
    .gte('created_at', from)
    .lte('created_at', to);

  if (error) throw error;

  const total = envelopes?.length || 0;
  const draft = envelopes?.filter((e: any) => e.status === 'draft').length || 0;
  const sent = envelopes?.filter((e: any) => e.status === 'sent').length || 0;
  const in_progress = envelopes?.filter((e: any) => e.status === 'in_progress').length || 0;
  const completed = envelopes?.filter((e: any) => e.status === 'completed').length || 0;
  const voided = envelopes?.filter((e: any) => e.status === 'voided').length || 0;

  // Calculate average completion time
  const completedEnvelopes = envelopes?.filter((e: any) => e.status === 'completed' && e.completed_at) || [];
  let avgDays = 0;
  if (completedEnvelopes.length > 0) {
    const totalDays = completedEnvelopes.reduce((sum: number, e: any) => {
      const created = new Date(e.created_at);
      const completed = new Date(e.completed_at);
      const days = Math.floor((completed.getTime() - created.getTime()) / (1000 * 60 * 60 * 24));
      return sum + days;
    }, 0);
    avgDays = Math.round(totalDays / completedEnvelopes.length);
  }

  const metrics = {
    total_contracts: total,
    draft_count: draft,
    sent_count: sent,
    in_progress_count: in_progress,
    completed_count: completed,
    voided_count: voided,
    completion_rate: total > 0 ? Math.round((completed / total) * 100) : 0,
    avg_completion_days: avgDays
  };

  return generateStatusHTML(metrics, from, to, companyName);
}

async function generateTrackingReport(supabase: any, from: string, to: string, companyName: string): Promise<string> {
  const { data: envelopes, error } = await supabase
    .from('signature_envelopes')
    .select(`
      *,
      events:signature_events(*)
    `)
    .gte('created_at', from)
    .lte('created_at', to)
    .order('created_at', { ascending: false });

  if (error) throw error;

  const contracts = (envelopes || []).map((env: any) => ({
    envelope_id: env.id,
    title: env.title || 'Untitled Contract',
    status: env.status,
    created_at: env.created_at,
    completed_at: env.completed_at,
    events: (env.events || []).map((evt: any) => ({
      event_type: evt.event_type,
      recipient_email: evt.recipient_email || 'System',
      occurred_at: evt.occurred_at,
      ip_address: evt.ip_address
    }))
  }));

  return generateTrackingHTML(contracts, from, to, companyName);
}

async function generateVolumeReport(supabase: any, from: string, to: string, companyName: string): Promise<string> {
  const { data: envelopes, error } = await supabase
    .from('signature_envelopes')
    .select('created_at, status')
    .gte('created_at', from)
    .lte('created_at', to);

  if (error) throw error;

  // Group by date
  const volumeByDate: Record<string, { total: number; completed: number; sent: number }> = {};
  
  (envelopes || []).forEach((env: any) => {
    const date = env.created_at.split('T')[0];
    if (!volumeByDate[date]) {
      volumeByDate[date] = { total: 0, completed: 0, sent: 0 };
    }
    volumeByDate[date].total++;
    if (env.status === 'completed') volumeByDate[date].completed++;
    if (env.status === 'sent' || env.status === 'in_progress') volumeByDate[date].sent++;
  });

  const volumeData = Object.entries(volumeByDate)
    .map(([date, data]) => ({ date, ...data }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return generateVolumeHTML(volumeData, from, to, companyName);
}

// HTML Generation Functions
function generateStatusHTML(metrics: any, from: string, to: string, companyName: string): string {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <title>Contract Status Report</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; margin: 40px; color: #1a1a1a; }
          .header { text-align: center; margin-bottom: 40px; border-bottom: 3px solid hsl(217, 91%, 60%); padding-bottom: 20px; }
          .header h1 { margin: 0; color: hsl(217, 91%, 60%); font-size: 28px; font-weight: 700; }
          .header p { margin: 8px 0; color: #666; font-size: 14px; }
          .metrics-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; margin-bottom: 40px; }
          .metric-card { border: 1px solid #e5e7eb; border-radius: 12px; padding: 24px; background: linear-gradient(135deg, #f9fafb 0%, #ffffff 100%); }
          .metric-label { font-size: 13px; color: #6b7280; margin-bottom: 8px; text-transform: uppercase; font-weight: 600; }
          .metric-value { font-size: 36px; font-weight: 700; color: hsl(217, 91%, 60%); }
          .metric-subtitle { font-size: 12px; color: #9ca3af; margin-top: 8px; }
          .status-breakdown { margin-top: 30px; padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px; background: #fafafa; }
          .status-row { display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid #e5e7eb; }
          .footer { margin-top: 50px; text-align: center; font-size: 11px; color: #9ca3af; border-top: 1px solid #e5e7eb; padding-top: 20px; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>${companyName}</h1>
          <p><strong>Contract Status Report</strong></p>
          <p>${new Date(from).toLocaleDateString()} - ${new Date(to).toLocaleDateString()}</p>
        </div>
        <div class="metrics-grid">
          <div class="metric-card"><div class="metric-label">Total</div><div class="metric-value">${metrics.total_contracts}</div></div>
          <div class="metric-card"><div class="metric-label">Completed</div><div class="metric-value">${metrics.completed_count}</div><div class="metric-subtitle">${metrics.completion_rate}% rate</div></div>
          <div class="metric-card"><div class="metric-label">In Progress</div><div class="metric-value">${metrics.in_progress_count}</div></div>
          <div class="metric-card"><div class="metric-label">Avg Days</div><div class="metric-value">${metrics.avg_completion_days}</div></div>
        </div>
        <div class="status-breakdown">
          <h2>Status Breakdown</h2>
          <div class="status-row"><span>📝 Draft</span><strong>${metrics.draft_count}</strong></div>
          <div class="status-row"><span>📤 Sent</span><strong>${metrics.sent_count}</strong></div>
          <div class="status-row"><span>⏳ In Progress</span><strong>${metrics.in_progress_count}</strong></div>
          <div class="status-row"><span>✅ Completed</span><strong>${metrics.completed_count}</strong></div>
          <div class="status-row"><span>🚫 Voided</span><strong>${metrics.voided_count}</strong></div>
        </div>
        <div class="footer"><p>Generated ${new Date().toLocaleString()}</p><p>${companyName} - Confidential</p></div>
      </body>
    </html>
  `;
}

function generateTrackingHTML(contracts: any[], from: string, to: string, companyName: string): string {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <title>Contract Tracking Report</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; margin: 40px; color: #1a1a1a; }
          .header { text-align: center; margin-bottom: 40px; border-bottom: 3px solid hsl(217, 91%, 60%); padding-bottom: 20px; }
          .header h1 { margin: 0; color: hsl(217, 91%, 60%); font-size: 28px; font-weight: 700; }
          .contract-item { margin-bottom: 25px; padding: 20px; border: 1px solid #e5e7eb; border-radius: 12px; background: #fafafa; }
          .contract-title { font-size: 16px; font-weight: 700; margin-bottom: 10px; }
          .event-item { padding: 8px; margin: 5px 0; background: white; border-radius: 6px; font-size: 13px; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>${companyName}</h1>
          <p><strong>Contract Tracking Report</strong></p>
          <p>${new Date(from).toLocaleDateString()} - ${new Date(to).toLocaleDateString()}</p>
        </div>
        ${contracts.map(c => `
          <div class="contract-item">
            <div class="contract-title">${c.title} [${c.status}]</div>
            <div style="font-size: 12px; color: #666; margin-bottom: 10px;">Created: ${new Date(c.created_at).toLocaleString()}</div>
            ${c.events.map((e: any) => `
              <div class="event-item">📌 ${e.event_type} - ${e.recipient_email} - ${new Date(e.occurred_at).toLocaleString()}</div>
            `).join('')}
          </div>
        `).join('')}
        <div class="footer" style="margin-top: 30px; text-align: center; font-size: 11px; color: #999;">Generated ${new Date().toLocaleString()}</div>
      </body>
    </html>
  `;
}

function generateVolumeHTML(volumeData: any[], from: string, to: string, companyName: string): string {
  const total = volumeData.reduce((sum, d) => sum + d.total, 0);
  const completed = volumeData.reduce((sum, d) => sum + d.completed, 0);
  const avg = Math.round(total / volumeData.length);

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <title>Contract Volume Report</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; margin: 40px; color: #1a1a1a; }
          .header { text-align: center; margin-bottom: 40px; border-bottom: 3px solid hsl(217, 91%, 60%); padding-bottom: 20px; }
          .header h1 { margin: 0; color: hsl(217, 91%, 60%); font-size: 28px; font-weight: 700; }
          .summary { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-bottom: 30px; }
          .summary-card { padding: 24px; border: 1px solid #e5e7eb; border-radius: 12px; text-align: center; background: #f9fafb; }
          .summary-value { font-size: 42px; font-weight: 700; color: hsl(217, 91%, 60%); }
          table { width: 100%; border-collapse: collapse; margin-top: 20px; }
          th, td { padding: 12px; text-align: left; border-bottom: 1px solid #e5e7eb; }
          th { background: hsl(217, 91%, 60%); color: white; font-weight: 700; font-size: 12px; }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>${companyName}</h1>
          <p><strong>Contract Volume Report</strong></p>
          <p>${new Date(from).toLocaleDateString()} - ${new Date(to).toLocaleDateString()}</p>
        </div>
        <div class="summary">
          <div class="summary-card"><div style="font-size: 13px; color: #666; margin-bottom: 10px;">TOTAL</div><div class="summary-value">${total}</div></div>
          <div class="summary-card"><div style="font-size: 13px; color: #666; margin-bottom: 10px;">COMPLETED</div><div class="summary-value">${completed}</div></div>
          <div class="summary-card"><div style="font-size: 13px; color: #666; margin-bottom: 10px;">AVG DAILY</div><div class="summary-value">${avg}</div></div>
        </div>
        <table>
          <thead><tr><th>Date</th><th>Total</th><th>Sent</th><th>Completed</th><th>Rate</th></tr></thead>
          <tbody>
            ${volumeData.map(d => `
              <tr>
                <td><strong>${new Date(d.date).toLocaleDateString()}</strong></td>
                <td>${d.total}</td>
                <td>${d.sent}</td>
                <td>${d.completed}</td>
                <td>${d.total > 0 ? Math.round((d.completed / d.total) * 100) : 0}%</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        <div style="margin-top: 30px; text-align: center; font-size: 11px; color: #999;">Generated ${new Date().toLocaleString()}</div>
      </body>
    </html>
  `;
}
