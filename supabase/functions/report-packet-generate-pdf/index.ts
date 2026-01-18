// ============================================================================
// REPORT PACKET GENERATE PDF
// Assembles the final PDF from section manifest
// ============================================================================

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, rgb, StandardFonts } from "https://esm.sh/pdf-lib@1.17.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface BrandingSnapshot {
  company_name: string;
  logo_url?: string;
  license_number?: string;
  phone?: string;
  email?: string;
  website?: string;
  address_line1?: string;
  address_city?: string;
  address_state?: string;
  address_zip?: string;
  primary_color?: string;
  secondary_color?: string;
  footer_disclaimer?: string;
}

interface SectionConfig {
  section_type: 'cover' | 'measurement' | 'photos' | 'estimate' | 'marketing' | 'signature';
  order: number;
  enabled: boolean;
  config?: Record<string, unknown>;
  file_id?: string;
  source_document_id?: string;
  display_name?: string;
}

// Helper to chunk array
function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += size) {
    chunks.push(array.slice(i, i + size));
  }
  return chunks;
}

// Helper to create photo grid page (3x2 layout)
async function createPhotoGridPage(
  pdfDoc: typeof PDFDocument.prototype,
  branding: BrandingSnapshot,
  photos: any[],
  pageNumber: number,
  currentPage: number,
  totalPages: number,
  showCaptions: boolean,
  supabase: any
): Promise<void> {
  const page = pdfDoc.addPage([612, 792]); // Letter size
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  
  const { width, height } = page.getSize();
  
  // Header
  page.drawRectangle({
    x: 0, y: height - 60, width: width, height: 60,
    color: rgb(0.15, 0.39, 0.92),
  });
  
  page.drawText('Photo Documentation', {
    x: 50, y: height - 38, size: 16, font: helveticaBold, color: rgb(1, 1, 1),
  });
  
  page.drawText(`Page ${currentPage} of ${totalPages}`, {
    x: width - 120, y: height - 38, size: 10, font: helvetica, color: rgb(0.9, 0.9, 0.9),
  });

  // Photo grid: 2 columns x 3 rows
  const margin = 40;
  const photoWidth = (width - margin * 3) / 2;
  const photoHeight = 180;
  const captionHeight = showCaptions ? 20 : 0;
  const gap = 15;
  
  let startY = height - 80;
  
  for (let i = 0; i < photos.length && i < 6; i++) {
    const col = i % 2;
    const row = Math.floor(i / 2);
    
    const x = margin + col * (photoWidth + gap);
    const y = startY - row * (photoHeight + captionHeight + gap) - photoHeight;
    
    // Photo placeholder box
    page.drawRectangle({
      x, y, width: photoWidth, height: photoHeight,
      borderColor: rgb(0.8, 0.8, 0.8), borderWidth: 1, color: rgb(0.95, 0.95, 0.95),
    });
    
    // Photo label
    const photo = photos[i];
    const label = photo.description || photo.category || `Photo ${i + 1}`;
    
    if (showCaptions) {
      page.drawText(label.substring(0, 40), {
        x: x + 5, y: y - 15, size: 8, font: helvetica, color: rgb(0.3, 0.3, 0.3),
      });
    }
    
    // Timestamp if available
    if (photo.created_at) {
      const timestamp = new Date(photo.created_at).toLocaleDateString();
      page.drawText(timestamp, {
        x: x + 5, y: y + 5, size: 7, font: helvetica, color: rgb(0.5, 0.5, 0.5),
      });
    }
  }
  
  // Footer
  page.drawText(`© ${new Date().getFullYear()} ${branding.company_name || 'PITCH CRM™'}`, {
    x: margin, y: 30, size: 8, font: helvetica, color: rgb(0.5, 0.5, 0.5),
  });
}

// Helper to create separator page
async function createSeparatorPage(
  pdfDoc: typeof PDFDocument.prototype,
  branding: BrandingSnapshot,
  sectionTitle: string,
  pageNumber: number
): Promise<void> {
  const page = pdfDoc.addPage([612, 792]); // Letter size
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  
  const { width, height } = page.getSize();
  
  // Header background
  page.drawRectangle({
    x: 0,
    y: height - 80,
    width: width,
    height: 80,
    color: rgb(0.15, 0.39, 0.92), // Primary blue
  });
  
  // Company name in header
  page.drawText(branding.company_name || 'Company', {
    x: 50,
    y: height - 50,
    size: 18,
    font: helveticaBold,
    color: rgb(1, 1, 1),
  });
  
  // License number if available
  if (branding.license_number) {
    page.drawText(`License: ${branding.license_number}`, {
      x: 50,
      y: height - 70,
      size: 10,
      font: helvetica,
      color: rgb(0.9, 0.9, 0.9),
    });
  }
  
  // Section title centered
  const titleWidth = helveticaBold.widthOfTextAtSize(sectionTitle, 28);
  page.drawText(sectionTitle, {
    x: (width - titleWidth) / 2,
    y: height / 2 + 20,
    size: 28,
    font: helveticaBold,
    color: rgb(0.2, 0.2, 0.2),
  });
  
  // Decorative line under title
  page.drawLine({
    start: { x: width / 4, y: height / 2 },
    end: { x: (3 * width) / 4, y: height / 2 },
    thickness: 2,
    color: rgb(0.15, 0.39, 0.92),
  });
  
  // Footer
  const footerY = 40;
  const footerText = [
    branding.phone,
    branding.email,
    branding.website
  ].filter(Boolean).join(' | ');
  
  if (footerText) {
    const footerWidth = helvetica.widthOfTextAtSize(footerText, 10);
    page.drawText(footerText, {
      x: (width - footerWidth) / 2,
      y: footerY,
      size: 10,
      font: helvetica,
      color: rgb(0.4, 0.4, 0.4),
    });
  }
  
  // Page number
  page.drawText(`Page ${pageNumber}`, {
    x: width - 70,
    y: footerY,
    size: 9,
    font: helvetica,
    color: rgb(0.5, 0.5, 0.5),
  });
}

// Helper to create cover page
async function createCoverPage(
  pdfDoc: typeof PDFDocument.prototype,
  branding: BrandingSnapshot,
  subjectData: Record<string, unknown>
): Promise<void> {
  const page = pdfDoc.addPage([612, 792]);
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  
  const { width, height } = page.getSize();
  
  // Full header area
  page.drawRectangle({
    x: 0,
    y: height - 200,
    width: width,
    height: 200,
    color: rgb(0.15, 0.39, 0.92),
  });
  
  // Company name large
  page.drawText(branding.company_name || 'Company Name', {
    x: 50,
    y: height - 80,
    size: 32,
    font: helveticaBold,
    color: rgb(1, 1, 1),
  });
  
  // License and contact
  let yPos = height - 120;
  if (branding.license_number) {
    page.drawText(`License: ${branding.license_number}`, {
      x: 50,
      y: yPos,
      size: 12,
      font: helvetica,
      color: rgb(0.9, 0.9, 0.9),
    });
    yPos -= 18;
  }
  
  if (branding.phone) {
    page.drawText(branding.phone, {
      x: 50,
      y: yPos,
      size: 12,
      font: helvetica,
      color: rgb(0.9, 0.9, 0.9),
    });
  }
  
  // Main content area
  const contentY = height - 280;
  
  page.drawText('Your Report & Estimate Package', {
    x: 50,
    y: contentY,
    size: 24,
    font: helveticaBold,
    color: rgb(0.2, 0.2, 0.2),
  });
  
  // Property address if available
  const propertyAddress = subjectData.address || subjectData.property_address || 'Property Address';
  page.drawText(String(propertyAddress), {
    x: 50,
    y: contentY - 50,
    size: 16,
    font: helvetica,
    color: rgb(0.3, 0.3, 0.3),
  });
  
  // Client name if available
  const clientName = subjectData.contact_name || subjectData.client_name || '';
  if (clientName) {
    page.drawText(`Prepared for: ${clientName}`, {
      x: 50,
      y: contentY - 80,
      size: 14,
      font: helvetica,
      color: rgb(0.4, 0.4, 0.4),
    });
  }
  
  // Date
  const today = new Date().toLocaleDateString('en-US', { 
    year: 'numeric', 
    month: 'long', 
    day: 'numeric' 
  });
  page.drawText(`Date: ${today}`, {
    x: 50,
    y: contentY - 110,
    size: 12,
    font: helvetica,
    color: rgb(0.5, 0.5, 0.5),
  });
  
  // Footer with disclaimer
  if (branding.footer_disclaimer) {
    const disclaimerLines = branding.footer_disclaimer.split('\n').slice(0, 3);
    let disclaimerY = 80;
    for (const line of disclaimerLines) {
      page.drawText(line.substring(0, 100), {
        x: 50,
        y: disclaimerY,
        size: 8,
        font: helvetica,
        color: rgb(0.6, 0.6, 0.6),
      });
      disclaimerY -= 12;
    }
  }
}

// Helper to create signature page
async function createSignaturePage(
  pdfDoc: typeof PDFDocument.prototype,
  branding: BrandingSnapshot,
  pageNumber: number
): Promise<void> {
  const page = pdfDoc.addPage([612, 792]);
  const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
  
  const { width, height } = page.getSize();
  
  // Header
  page.drawRectangle({
    x: 0,
    y: height - 60,
    width: width,
    height: 60,
    color: rgb(0.15, 0.39, 0.92),
  });
  
  page.drawText(branding.company_name || 'Company', {
    x: 50,
    y: height - 40,
    size: 16,
    font: helveticaBold,
    color: rgb(1, 1, 1),
  });
  
  // Title
  page.drawText('Acceptance & Authorization', {
    x: 50,
    y: height - 120,
    size: 22,
    font: helveticaBold,
    color: rgb(0.2, 0.2, 0.2),
  });
  
  // Terms text
  const termsText = `By signing below, I acknowledge that I have reviewed and accept the scope of work 
and pricing outlined in this report package. I authorize the contractor to proceed 
with the work as described and agree to the payment terms specified.

I understand that:
• This authorization represents a binding agreement
• Work will commence upon approval and scheduling
• Any changes to the scope will require written authorization
• Payment is due according to the terms specified in the estimate`;

  let termsY = height - 170;
  for (const line of termsText.split('\n')) {
    page.drawText(line.trim(), {
      x: 50,
      y: termsY,
      size: 11,
      font: helvetica,
      color: rgb(0.3, 0.3, 0.3),
    });
    termsY -= 18;
  }
  
  // Signature fields
  const fieldY = height - 450;
  
  // Signature line
  page.drawText('Signature:', {
    x: 50,
    y: fieldY,
    size: 12,
    font: helveticaBold,
    color: rgb(0.2, 0.2, 0.2),
  });
  page.drawLine({
    start: { x: 130, y: fieldY - 5 },
    end: { x: 400, y: fieldY - 5 },
    thickness: 1,
    color: rgb(0.3, 0.3, 0.3),
  });
  
  // Printed name
  page.drawText('Printed Name:', {
    x: 50,
    y: fieldY - 50,
    size: 12,
    font: helveticaBold,
    color: rgb(0.2, 0.2, 0.2),
  });
  page.drawLine({
    start: { x: 150, y: fieldY - 55 },
    end: { x: 400, y: fieldY - 55 },
    thickness: 1,
    color: rgb(0.3, 0.3, 0.3),
  });
  
  // Date
  page.drawText('Date:', {
    x: 420,
    y: fieldY - 50,
    size: 12,
    font: helveticaBold,
    color: rgb(0.2, 0.2, 0.2),
  });
  page.drawLine({
    start: { x: 460, y: fieldY - 55 },
    end: { x: 562, y: fieldY - 55 },
    thickness: 1,
    color: rgb(0.3, 0.3, 0.3),
  });
  
  // Footer
  page.drawText(`Page ${pageNumber}`, {
    x: width - 70,
    y: 40,
    size: 9,
    font: helvetica,
    color: rgb(0.5, 0.5, 0.5),
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'UNAUTHORIZED', message: 'Missing authorization' } }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Auth
    const anonClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } }
    });
    const { data: { user }, error: authError } = await anonClient.auth.getUser();
    if (authError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid user' } }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { data: tenantId } = await anonClient.rpc('get_user_active_tenant_id');
    if (!tenantId) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'NO_TENANT', message: 'No active tenant' } }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { packet_id } = await req.json();
    if (!packet_id) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'VALIDATION_ERROR', message: 'packet_id required' } }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch packet
    const { data: packet, error: packetError } = await supabase
      .from('report_packets')
      .select('*')
      .eq('id', packet_id)
      .eq('tenant_id', tenantId)
      .single();

    if (packetError || !packet) {
      return new Response(
        JSON.stringify({ success: false, error: { code: 'NOT_FOUND', message: 'Packet not found' } }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const branding = packet.branding_snapshot as BrandingSnapshot;
    const sections = (packet.section_manifest as SectionConfig[]).filter(s => s.enabled).sort((a, b) => a.order - b.order);

    // Fetch subject data for cover page
    let subjectData: Record<string, unknown> = {};
    try {
      if (packet.subject_type === 'job') {
        const { data } = await supabase.from('jobs').select('*, contacts(*)').eq('id', packet.subject_id).single();
        subjectData = data || {};
      } else if (packet.subject_type === 'contact') {
        const { data } = await supabase.from('contacts').select('*').eq('id', packet.subject_id).single();
        subjectData = data || {};
      } else if (packet.subject_type === 'project') {
        const { data } = await supabase.from('projects').select('*, contacts(*)').eq('id', packet.subject_id).single();
        subjectData = data || {};
      }
    } catch (e) {
      console.log('Could not fetch subject data:', e);
    }

    // Create merged PDF
    const mergedPdf = await PDFDocument.create();
    let pageNumber = 1;

    for (const section of sections) {
      switch (section.section_type) {
        case 'cover':
          await createCoverPage(mergedPdf, branding, subjectData);
          pageNumber++;
          break;

        case 'measurement':
        case 'estimate':
        case 'marketing':
          // Add separator page
          const sectionTitles: Record<string, string> = {
            measurement: 'Measurement Report',
            estimate: 'Estimate',
            marketing: 'About Our Company'
          };
          await createSeparatorPage(mergedPdf, branding, section.display_name || sectionTitles[section.section_type], pageNumber);
          pageNumber++;

          // If there's a source document, fetch and merge it
          if (section.source_document_id) {
            try {
              const { data: doc } = await supabase
                .from('documents')
                .select('storage_path, storage_bucket')
                .eq('id', section.source_document_id)
                .single();

              if (doc) {
                const { data: fileData } = await supabase.storage
                  .from(doc.storage_bucket || 'documents')
                  .download(doc.storage_path);

                if (fileData) {
                  const pdfBytes = await fileData.arrayBuffer();
                  const importedPdf = await PDFDocument.load(pdfBytes);
                  const pages = await mergedPdf.copyPages(importedPdf, importedPdf.getPageIndices());
                  pages.forEach(page => {
                    mergedPdf.addPage(page);
                    pageNumber++;
                  });
                }
              }
            } catch (e) {
              console.error('Error importing PDF:', e);
            }
          }
          break;

        case 'photos':
          // Create photo documentation pages with grid layout
          const photoConfig = section.config || {};
          const photosPerPage = (photoConfig as any).photos_per_page || 6;
          const showCaptions = (photoConfig as any).show_captions !== false;
          
          // Fetch photos from job_photos or pipeline entry
          let photos: any[] = [];
          
          try {
            // Try to get photos from the packet's pipeline entry or project
            const { data: packetData } = await supabase
              .from('report_packets')
              .select('pipeline_entry_id, project_id')
              .eq('id', packet_id)
              .single();
            
            if (packetData?.pipeline_entry_id) {
              const { data: entryPhotos } = await supabase
                .from('job_photos')
                .select('*')
                .eq('pipeline_entry_id', packetData.pipeline_entry_id)
                .order('created_at', { ascending: true });
              photos = entryPhotos || [];
            } else if (packetData?.project_id) {
              const { data: projectPhotos } = await supabase
                .from('job_photos')
                .select('*')
                .eq('project_id', packetData.project_id)
                .order('created_at', { ascending: true });
              photos = projectPhotos || [];
            }
          } catch (e) {
            console.error('Error fetching photos:', e);
          }

          if (photos.length === 0) {
            // Create placeholder page if no photos
            await createSeparatorPage(mergedPdf, branding, 'Photo Documentation', pageNumber);
            pageNumber++;
          } else {
            // Create photo grid pages
            const photoChunks = chunkArray(photos, photosPerPage);
            
            for (let chunkIndex = 0; chunkIndex < photoChunks.length; chunkIndex++) {
              const chunk = photoChunks[chunkIndex];
              await createPhotoGridPage(
                mergedPdf, 
                branding, 
                chunk, 
                pageNumber, 
                chunkIndex + 1, 
                photoChunks.length,
                showCaptions,
                supabase
              );
              pageNumber++;
            }
          }
          break;

        case 'signature':
          await createSignaturePage(mergedPdf, branding, pageNumber);
          pageNumber++;
          break;
      }
    }

    // Save merged PDF
    const pdfBytes = await mergedPdf.save();
    const pdfHash = await crypto.subtle.digest('SHA-256', pdfBytes);
    const hashHex = Array.from(new Uint8Array(pdfHash)).map(b => b.toString(16).padStart(2, '0')).join('');

    // Upload to storage
    const storagePath = `${tenantId}/${packet_id}/final-packet-v${packet.render_version + 1}.pdf`;
    const { error: uploadError } = await supabase.storage
      .from('report-packets')
      .upload(storagePath, pdfBytes, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      return new Response(
        JSON.stringify({ success: false, error: { code: 'UPLOAD_ERROR', message: 'Failed to upload PDF' } }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Update packet
    const { error: updateError } = await supabase
      .from('report_packets')
      .update({
        status: 'generated',
        final_pdf_storage_path: storagePath,
        final_pdf_hash: hashHex,
        final_pdf_page_count: mergedPdf.getPageCount(),
        render_version: packet.render_version + 1,
        updated_at: new Date().toISOString()
      })
      .eq('id', packet_id);

    if (updateError) {
      console.error('Update error:', updateError);
    }

    // Create file record
    await supabase.from('report_packet_files').insert({
      tenant_id: tenantId,
      packet_id,
      kind: 'final_packet',
      storage_path: storagePath,
      storage_bucket: 'report-packets',
      filename: `report-packet-v${packet.render_version + 1}.pdf`,
      content_type: 'application/pdf',
      byte_size: pdfBytes.byteLength,
      sha256: hashHex,
      page_count: mergedPdf.getPageCount()
    });

    // Log event
    await supabase.from('report_packet_events').insert({
      tenant_id: tenantId,
      packet_id,
      event_type: 'packet_regenerated',
      actor_type: 'internal_user',
      actor_user_id: user.id,
      meta: {
        render_version: packet.render_version + 1,
        page_count: mergedPdf.getPageCount(),
        file_size: pdfBytes.byteLength
      }
    });

    return new Response(
      JSON.stringify({
        success: true,
        data: {
          packet_id,
          storage_path: storagePath,
          page_count: mergedPdf.getPageCount(),
          render_version: packet.render_version + 1,
          hash: hashHex
        }
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Unexpected error:', error);
    return new Response(
      JSON.stringify({ success: false, error: { code: 'INTERNAL_ERROR', message: String(error) } }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
