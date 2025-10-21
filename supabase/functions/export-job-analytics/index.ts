import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ExportRequest {
  from?: string;
  to?: string;
  recipients: string[];
  subject?: string;
  message?: string;
  html?: string;
  render_url?: string;
  metrics?: any;
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('Export job analytics - Request received');

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const edgeBase = Deno.env.get('EDGE_BASE') || supabaseUrl.replace('.supabase.co', '.functions.supabase.co');
    const companyName = Deno.env.get('COMPANY_NAME') || 'PITCH Roofing CRM';

    const supabase = createClient(supabaseUrl, supabaseKey);
    const body: ExportRequest = await req.json();
    
    // Determine date range (default last 30 days)
    const today = new Date();
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(today.getDate() - 30);
    
    const from = body.from || thirtyDaysAgo.toISOString().split('T')[0];
    const to = body.to || today.toISOString().split('T')[0];
    
    console.log(`Date range: ${from} to ${to}`);
    
    // Generate or fetch HTML
    let html: string;
    if (body.html) {
      console.log('Using provided HTML');
      html = body.html;
    } else if (body.render_url) {
      console.log(`Fetching HTML from render_url: ${body.render_url}`);
      const response = await fetch(body.render_url);
      html = await response.text();
    } else if (body.metrics) {
      console.log('Generating HTML from metrics');
      html = generateHTMLFromMetrics(body.metrics, from, to, companyName);
    } else {
      console.log('Fetching metrics from database');
      const metrics = await fetchMetricsFromDB(supabase, from, to);
      html = generateHTMLFromMetrics(metrics, from, to, companyName);
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
        filename: `job_analytics_${from}_${to}.pdf`
      })
    });
    
    if (!pdfResponse.ok) {
      const errorText = await pdfResponse.text();
      throw new Error(`PDF generation failed: ${errorText}`);
    }
    
    const pdfData = await pdfResponse.json();
    console.log('PDF generated successfully:', pdfData.pdf_url);
    
    // Email PDF link to recipients
    const recipients = body.recipients || Deno.env.get('DEFAULT_MANAGER_TO')?.split(',') || [];
    const subject = body.subject || `Job Analytics Report: ${from} to ${to}`;
    const emailBody = `${body.message || 'Job Analytics Report'}\n\nView Report: ${pdfData.pdf_url}\n\nNote: This link will expire in 7 days.`;
    
    console.log(`Sending emails to ${recipients.length} recipient(s)`);
    
    const emailResults = [];
    for (const recipient of recipients) {
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
    
    return new Response(
      JSON.stringify({ 
        success: true, 
        pdf_url: pdfData.pdf_url,
        recipients_count: recipients.length,
        email_results: emailResults,
        date_range: { from, to }
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );
    
  } catch (error) {
    console.error('Export error:', error);
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

async function fetchMetricsFromDB(supabase: any, from: string, to: string) {
  const { data: jobs, error } = await supabase
    .from('jobs')
    .select('*')
    .gte('created_at', from)
    .lte('created_at', to);

  if (error) throw error;

  const total = jobs?.length || 0;
  const leads = jobs?.filter((j: any) => j.status === 'lead').length || 0;
  const legal = jobs?.filter((j: any) => j.status === 'legal').length || 0;
  const contingency = jobs?.filter((j: any) => j.status === 'contingency').length || 0;
  const readyForApproval = jobs?.filter((j: any) => j.status === 'ready_for_approval').length || 0;
  const production = jobs?.filter((j: any) => j.status === 'production').length || 0;
  const finalPayment = jobs?.filter((j: any) => j.status === 'final_payment').length || 0;
  const closed = jobs?.filter((j: any) => j.status === 'closed').length || 0;

  return {
    total_jobs: total,
    lead_jobs: leads,
    legal_jobs: legal,
    contingency_jobs: contingency,
    ready_for_approval_jobs: readyForApproval,
    production_jobs: production,
    final_payment_jobs: finalPayment,
    closed_jobs: closed,
    completion_rate: total > 0 ? Math.round((closed / total) * 100) : 0
  };
}

function generateHTMLFromMetrics(metrics: any, from: string, to: string, companyName: string): string {
  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <title>Job Analytics Report</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            margin: 40px;
            color: #333;
          }
          .header {
            text-align: center;
            margin-bottom: 40px;
            border-bottom: 2px solid #0066cc;
            padding-bottom: 20px;
          }
          .header h1 {
            margin: 0;
            color: #0066cc;
          }
          .header p {
            margin: 5px 0;
            color: #666;
          }
          .metrics-grid {
            display: grid;
            grid-template-columns: repeat(2, 1fr);
            gap: 20px;
            margin-bottom: 30px;
          }
          .metric-card {
            border: 1px solid #e0e0e0;
            border-radius: 8px;
            padding: 20px;
            background: #f9f9f9;
          }
          .metric-label {
            font-size: 14px;
            color: #666;
            margin-bottom: 8px;
          }
          .metric-value {
            font-size: 32px;
            font-weight: bold;
            color: #0066cc;
          }
          .metric-subtitle {
            font-size: 12px;
            color: #999;
            margin-top: 4px;
          }
          table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 20px;
          }
          th, td {
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #e0e0e0;
          }
          th {
            background: #f0f0f0;
            font-weight: bold;
          }
          .footer {
            margin-top: 40px;
            text-align: center;
            font-size: 12px;
            color: #999;
            border-top: 1px solid #e0e0e0;
            padding-top: 20px;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>${companyName}</h1>
          <p>Job Analytics Report</p>
          <p>${from} to ${to}</p>
        </div>

        <div class="metrics-grid">
          <div class="metric-card">
            <div class="metric-label">Total Jobs</div>
            <div class="metric-value">${metrics.total_jobs || 0}</div>
          </div>
          <div class="metric-card">
            <div class="metric-label">Leads</div>
            <div class="metric-value">${metrics.lead_jobs || 0}</div>
            <div class="metric-subtitle">${metrics.total_jobs > 0 ? Math.round((metrics.lead_jobs / metrics.total_jobs) * 100) : 0}% of total</div>
          </div>
          <div class="metric-card">
            <div class="metric-label">Production</div>
            <div class="metric-value">${metrics.production_jobs || 0}</div>
            <div class="metric-subtitle">${metrics.total_jobs > 0 ? Math.round((metrics.production_jobs / metrics.total_jobs) * 100) : 0}% of total</div>
          </div>
          <div class="metric-card">
            <div class="metric-label">Closed Jobs</div>
            <div class="metric-value">${metrics.closed_jobs || 0}</div>
            <div class="metric-subtitle">${metrics.completion_rate || 0}% completion rate</div>
          </div>
        </div>

        <table>
          <thead>
            <tr>
              <th>Status</th>
              <th>Count</th>
              <th>Percentage</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Leads</td>
              <td>${metrics.lead_jobs || 0}</td>
              <td>${metrics.total_jobs > 0 ? Math.round((metrics.lead_jobs / metrics.total_jobs) * 100) : 0}%</td>
            </tr>
            <tr>
              <td>Legal</td>
              <td>${metrics.legal_jobs || 0}</td>
              <td>${metrics.total_jobs > 0 ? Math.round((metrics.legal_jobs / metrics.total_jobs) * 100) : 0}%</td>
            </tr>
            <tr>
              <td>Contingency</td>
              <td>${metrics.contingency_jobs || 0}</td>
              <td>${metrics.total_jobs > 0 ? Math.round((metrics.contingency_jobs / metrics.total_jobs) * 100) : 0}%</td>
            </tr>
            <tr>
              <td>Ready for Approval</td>
              <td>${metrics.ready_for_approval_jobs || 0}</td>
              <td>${metrics.total_jobs > 0 ? Math.round((metrics.ready_for_approval_jobs / metrics.total_jobs) * 100) : 0}%</td>
            </tr>
            <tr>
              <td>Production</td>
              <td>${metrics.production_jobs || 0}</td>
              <td>${metrics.total_jobs > 0 ? Math.round((metrics.production_jobs / metrics.total_jobs) * 100) : 0}%</td>
            </tr>
            <tr>
              <td>Final Payment</td>
              <td>${metrics.final_payment_jobs || 0}</td>
              <td>${metrics.total_jobs > 0 ? Math.round((metrics.final_payment_jobs / metrics.total_jobs) * 100) : 0}%</td>
            </tr>
            <tr>
              <td>Closed</td>
              <td>${metrics.closed_jobs || 0}</td>
              <td>${metrics.total_jobs > 0 ? Math.round((metrics.closed_jobs / metrics.total_jobs) * 100) : 0}%</td>
            </tr>
          </tbody>
        </table>

        <div class="footer">
          <p>Generated on ${new Date().toLocaleString()}</p>
          <p>${companyName} - Confidential</p>
        </div>
      </body>
    </html>
  `;
}
