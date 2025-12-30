import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";
import puppeteer from "https://deno.land/x/puppeteer@16.2.0/mod.ts";
import chromium from "https://esm.sh/@sparticuz/chromium@123.0.1";
import { Resend } from "npm:resend@4.0.0";
import { corsHeaders } from "../_shared/cors.ts";

interface PDFRequest {
  instance_id?: string;
  html?: string;
  upload?: 'public' | 'signed' | 'private';
  filename?: string;
  to_email?: string;
  subject?: string;
  message?: string;
  attach?: boolean;
}

const handler = async (req: Request): Promise<Response> => {
  const startTime = Date.now();
  
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  let tenantId: string | null = null;
  let instanceId: string | undefined;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const bucketName = Deno.env.get("SMART_DOCS_BUCKET") || "smart-docs";
    const resendKey = Deno.env.get("RESEND_API_KEY");
    const fromDomain = Deno.env.get("RESEND_FROM_DOMAIN") || "resend.dev";
    const fromEmail = Deno.env.get("FROM_EMAIL") || `PITCH CRM <noreply@${fromDomain}>`;

    const supabase = createClient(supabaseUrl, serviceKey);
    
    const {
      instance_id,
      html: providedHtml,
      upload = 'signed',
      filename = `report-${Date.now()}.pdf`,
      to_email,
      subject = 'Your Report',
      message = 'Please find your report attached.',
      attach = false
    }: PDFRequest = await req.json();

    instanceId = instance_id;

    let html = providedHtml;
    let tenantId: string | null = null;

    // Fetch HTML from instance if instance_id provided
    if (instance_id) {
      const { data: instance, error } = await supabase
        .from('smart_doc_instances')
        .select('rendered_html, tenant_id')
        .eq('id', instance_id)
        .single();

      if (error || !instance) {
        throw new Error('Instance not found');
      }

      html = instance.rendered_html;
      tenantId = instance.tenant_id;
    }

    if (!html) {
      throw new Error('No HTML content provided');
    }

    console.log('Launching Puppeteer with Chromium...');

    // Launch browser with serverless Chromium
    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    console.log('Generating PDF...');

    // Generate PDF
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '0.5in',
        right: '0.5in',
        bottom: '0.5in',
        left: '0.5in'
      }
    });

    await browser.close();

    console.log('PDF generated, uploading to storage...');

    // Prepare storage path
    const storagePath = tenantId 
      ? `${tenantId}/instances/${instance_id || Date.now()}/${filename}`
      : `public/${Date.now()}/${filename}`;

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from(bucketName)
      .upload(storagePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadError) {
      throw new Error(`Upload failed: ${uploadError.message}`);
    }

    console.log('PDF uploaded to storage:', storagePath);

    // Generate URL based on upload mode
    let pdfUrl: string;
    
    if (upload === 'public') {
      const { data } = supabase.storage
        .from(bucketName)
        .getPublicUrl(storagePath);
      pdfUrl = data.publicUrl;
    } else if (upload === 'signed') {
      const { data, error: signError } = await supabase.storage
        .from(bucketName)
        .createSignedUrl(storagePath, 60 * 60 * 24 * 7); // 7 days
      
      if (signError) throw signError;
      pdfUrl = data.signedUrl;
    } else {
      pdfUrl = storagePath; // private, just store path
    }

    // Update instance with pdf_url and storage_path
    if (instance_id) {
      await supabase
        .from('smart_doc_instances')
        .update({ 
          pdf_url: pdfUrl,
          storage_path: storagePath
        })
        .eq('id', instance_id);
    }

    // Send email if requested
    let emailed = false;
    if (to_email && resendKey) {
      console.log('Sending email to:', to_email);
      
      const resend = new Resend(resendKey);
      const pdfSizeKB = pdfBuffer.byteLength / 1024;
      const pdfSizeMB = pdfSizeKB / 1024;

      if (attach && pdfSizeMB < 7) {
        // Send as attachment
        const base64Pdf = btoa(String.fromCharCode(...new Uint8Array(pdfBuffer)));
        
        await resend.emails.send({
          from: fromEmail,
          to: [to_email],
          subject,
          html: `<p>${message}</p>`,
          attachments: [{
            filename,
            content: base64Pdf
          }]
        });
      } else {
        // Send as link
        await resend.emails.send({
          from: fromEmail,
          to: [to_email],
          subject,
          html: `
            <p>${message}</p>
            <p><a href="${pdfUrl}" style="display: inline-block; padding: 12px 24px; background-color: #2563eb; color: white; text-decoration: none; border-radius: 6px; margin-top: 16px;">View Report</a></p>
          `
        });
      }

      emailed = true;
      console.log('Email sent successfully');
    }

    // Log success to database
    const duration = Date.now() - startTime;
    if (tenantId) {
      await supabase.rpc('log_function_error', {
        p_function_name: 'smart-docs-pdf',
        p_error_message: 'PDF generated successfully',
        p_context: {
          instance_id: instanceId,
          filename,
          size_kb: Math.round(pdfBuffer.byteLength / 1024),
          emailed,
          upload_mode: upload
        }
      }).catch(e => console.error('Failed to log success:', e));
    }

    return new Response(
      JSON.stringify({
        ok: true,
        pdf_url: pdfUrl,
        storage_path: storagePath,
        emailed,
        size_kb: Math.round(pdfBuffer.byteLength / 1024),
        duration_ms: duration
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );

  } catch (error: any) {
    console.error('PDF generation error:', error);
    
    // Log error to database
    const duration = Date.now() - startTime;
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );
    
    await supabase.rpc('log_function_error', {
      p_function_name: 'smart-docs-pdf',
      p_error_message: error.message,
      p_context: {
        instance_id: instanceId,
        tenant_id: tenantId,
        duration_ms: duration
      },
      p_error_stack: error.stack
    }).catch(e => console.error('Failed to log error:', e));
    
    return new Response(
      JSON.stringify({ 
        ok: false, 
        error: error.message 
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );
  }
};

serve(handler);
