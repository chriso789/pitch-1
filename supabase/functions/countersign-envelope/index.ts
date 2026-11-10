import { PDFDocument, StandardFonts } from "npm:pdf-lib@1.17.1";
import {
  createServiceClient,
  hashToken,
  logAuditEvent,
  createNotification,
  successResponse,
  errorResponse,
  handleCors,
  getClientInfo,
} from '../_shared/utils.ts';
import {
  anchorFromStored,
  appendSignaturePage,
  dataUrlToBytes,
  embedSignatureImage,
  formatUsd,
  stampSignature,
  validateAnchor,
  type Box,
  type SignatureAnchor,
} from '../_shared/signature-placement/index.ts';

// ============================================================================
// COUNTERSIGN ENVELOPE
// After the client has signed (envelope.status === 'awaiting_countersignature'),
// the company representative (envelope.created_by, or any teammate with access)
// adds their saved profile signature to the right half of the signature block,
// completes the envelope, and emails the fully-signed PDF to all parties.
// ============================================================================

interface CountersignRequest {
  envelope_id: string;
  force_rebuild?: boolean;
}

Deno.serve(async (req: Request) => {
  const corsResponse = handleCors(req);
  if (corsResponse) return corsResponse;

  if (req.method !== 'POST') {
    return errorResponse('METHOD_NOT_ALLOWED', 'Only POST requests allowed', 405);
  }

  try {
    const supabase = createServiceClient();
    const { ip, userAgent } = getClientInfo(req);

    const body: CountersignRequest = await req.json();
    if (!body.envelope_id) {
      return errorResponse('VALIDATION_ERROR', 'Missing envelope_id', 400);
    }

    // Authenticated caller
    const authHeader = req.headers.get('Authorization') || '';
    const jwt = authHeader.replace(/^Bearer\s+/i, '');
    if (!jwt) return errorResponse('UNAUTHORIZED', 'Missing auth token', 401);
    const { data: userData, error: userErr } = await supabase.auth.getUser(jwt);
    if (userErr || !userData?.user) {
      return errorResponse('UNAUTHORIZED', 'Invalid auth token', 401);
    }
    const callerId = userData.user.id;

    // Load envelope
    const { data: envelope, error: envErr } = await supabase
      .from('signature_envelopes')
      .select('*')
      .eq('id', body.envelope_id)
      .single();

    if (envErr || !envelope) {
      return errorResponse('NOT_FOUND', 'Envelope not found', 404);
    }
    if (envelope.countersigned_at && envelope.status === 'completed' && !body.force_rebuild) {
      return successResponse({
        message: 'Envelope already countersigned',
        envelope_id: envelope.id,
        signed_pdf_path: envelope.signed_pdf_path,
      });
    }
    if (envelope.status !== 'awaiting_countersignature' && envelope.status !== 'completed') {
      return errorResponse(
        'INVALID_STATE',
        `Envelope is not ready for countersignature (status=${envelope.status})`,
        400
      );
    }
    if (!envelope.signed_pdf_path) {
      return errorResponse('INVALID_STATE', 'Envelope has no signed PDF to countersign', 400);
    }

    // Load rep profile + saved signature
    const { data: repProfile } = await supabase
      .from('profiles')
      .select('id, first_name, last_name, email, tenant_id, signature_image_path')
      .eq('id', callerId)
      .maybeSingle();

    if (!repProfile) {
      return errorResponse('FORBIDDEN', 'No profile found for caller', 403);
    }
    if (repProfile.tenant_id !== envelope.tenant_id) {
      return errorResponse('FORBIDDEN', 'Not allowed to countersign this envelope', 403);
    }
    if (!repProfile.signature_image_path) {
      return errorResponse(
        'NO_SIGNATURE',
        'You have not saved a signature yet. Set one up in Settings → My Signature.',
        400
      );
    }

    // The signed PDF the client signed. For force rebuilds on already completed
    // envelopes, prefer the clean client-signed artifact over the previous
    // countersigned PDF so we don't leave the old misplaced rep stamp behind.
    let signedPath = envelope.signed_pdf_path;
    if (body.force_rebuild && envelope.id) {
      try {
        const { data: clientSignedDoc } = await supabase
          .from('documents')
          .select('file_path')
          .eq('tenant_id', envelope.tenant_id)
          .ilike('file_path', `%/${envelope.id}/signed_%`)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (clientSignedDoc?.file_path) {
          signedPath = clientSignedDoc.file_path;
          console.log(`Force rebuild using clean client-signed PDF: ${signedPath}`);
        }
      } catch (e) {
        console.warn('Could not locate clean client-signed PDF for rebuild:', e);
      }
    }
    if (!signedPath) {
      return errorResponse('INVALID_STATE', 'Envelope has no signed PDF yet', 400);
    }

    const downloadPdf = async (path: string): Promise<Uint8Array | null> => {
      for (const bucket of ['documents', 'smartdoc-renditions']) {
        const { data, error } = await supabase.storage.from(bucket).download(path);
        if (data && !error) return new Uint8Array(await data.arrayBuffer());
      }
      return null;
    };

    const clientSignedBytes = await downloadPdf(signedPath);
    if (!clientSignedBytes) {
      console.error('Could not download client-signed PDF:', signedPath);
      return errorResponse('STORAGE_ERROR', 'Could not load signed PDF', 500);
    }

    // Load signature anchor from the linked estimate (same source finalize-envelope uses)
    let storedAnchor: SignatureAnchor | null = null;
    let linkedEstimateRow: { id: string; estimate_number?: string | null; selling_price?: number | null; total_with_tax?: number | null } | null = null;
    try {
      const { data: linkedEstimate } = await supabase
        .from('enhanced_estimates')
        .select('id, estimate_number, selling_price, total_with_tax, signature_anchor')
        .eq('signature_envelope_id', envelope.id)
        .maybeSingle();
      if (linkedEstimate) {
        linkedEstimateRow = linkedEstimate as any;
        storedAnchor = anchorFromStored((linkedEstimate as any).signature_anchor);
      }
    } catch (e) {
      console.warn('Could not load signature_anchor:', e);
    }

    let pdfDoc = await PDFDocument.load(clientSignedBytes);
    let fonts = {
      regular: await pdfDoc.embedFont(StandardFonts.Helvetica),
      bold: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
    };
    let anchor = validateAnchor(storedAnchor, pdfDoc.getPageCount(), (i) => pdfDoc.getPage(i).getSize());

    // Tenant name for label
    let tenantName = 'Authorized Representative';
    try {
      const { data: tenant } = await supabase
        .from('tenants')
        .select('name')
        .eq('id', envelope.tenant_id)
        .single();
      if (tenant?.name) tenantName = tenant.name;
    } catch { /* noop */ }

    // Repair: older estimates stored signature lines that were clipped below
    // the page, so the customer signature was stamped over the fine print and
    // the company line was never visible. Rebuild from the original unsigned
    // estimate, add a real signature page and place every signature on it.
    let repairedPlacement = false;
    if (!anchor && storedAnchor && envelope.generated_pdf_path) {
      const originalBytes = await downloadPdf(envelope.generated_pdf_path);
      const { data: signatures } = await supabase
        .from('digital_signatures')
        .select('*, recipient:signature_recipients(recipient_name)')
        .eq('envelope_id', envelope.id);
      if (originalBytes && signatures && signatures.length > 0) {
        pdfDoc = await PDFDocument.load(originalBytes);
        fonts = {
          regular: await pdfDoc.embedFont(StandardFonts.Helvetica),
          bold: await pdfDoc.embedFont(StandardFonts.HelveticaBold),
        };
        anchor = appendSignaturePage(pdfDoc, fonts, {
          title: envelope.title,
          reference: linkedEstimateRow?.estimate_number ?? null,
          totalText: formatUsd(linkedEstimateRow?.selling_price ?? linkedEstimateRow?.total_with_tax),
          companyName: tenantName,
        });
        const sigPage = pdfDoc.getPage(anchor.pageIndex);
        for (const sig of signatures) {
          const meta = (sig.signature_metadata || {}) as Record<string, unknown>;
          const recipientName = (sig.recipient as any)?.recipient_name || 'Customer';
          const dateText = sig.signed_at ? new Date(sig.signed_at).toLocaleDateString() : new Date().toLocaleDateString();
          const auditText = `${recipientName}  •  IP: ${sig.ip_address || 'N/A'}`;
          let imageBytes: Uint8Array | null = null;
          if (typeof meta.image_path === 'string') {
            const { data: img } = await supabase.storage.from('signatures').download(meta.image_path);
            if (img) imageBytes = new Uint8Array(await img.arrayBuffer());
          } else if (typeof sig.signature_data === 'string' && sig.signature_data.startsWith('data:image')) {
            imageBytes = dataUrlToBytes(sig.signature_data);
          }
          const target = { sig: anchor.customerSig!, date: anchor.customerDate ?? null };
          if (imageBytes) {
            stampSignature(sigPage, fonts, target, { image: await embedSignatureImage(pdfDoc, imageBytes), dateText, auditText });
          } else if (sig.signature_data) {
            stampSignature(sigPage, fonts, target, { typed: sig.signature_data, dateText, auditText });
          }
        }
        repairedPlacement = true;
        console.warn(`Rebuilt envelope ${envelope.id} with signature page ${anchor.pageIndex}; stored anchor was off page.`);
      }
    }
    if (!anchor && storedAnchor) {
      return errorResponse(
        'SIGNATURE_PLACEMENT',
        'The signature lines on this estimate are not visible on the page, and the original could not be rebuilt. Regenerate and resend the estimate.',
        409,
      );
    }

    const pageCount = pdfDoc.getPageCount();
    // ALWAYS target the same page the customer signed on so the rep signature
    // lands in the right-hand "Company Representative" column next to it.
    const targetPageIdx =
      anchor
        ? anchor.pageIndex
        : envelope.signature_page_index != null && envelope.signature_page_index < pageCount
        ? envelope.signature_page_index
        : pageCount - 1;
    const page = pdfDoc.getPage(targetPageIdx);
    console.log(`Countersign targeting page ${targetPageIdx} (signature_page_index=${envelope.signature_page_index}, pageCount=${pageCount}, anchorPage=${anchor?.pageIndex ?? 'null'}, repaired=${repairedPlacement}, force_rebuild=${!!body.force_rebuild})`);
    const { height: pageH, width: pageW } = page.getSize();

    const fallbackBlockBottomY = anchor ? anchor.yPt : Math.max(80, pageH * 0.18);
    const fallbackBlockLeftX = anchor ? anchor.xPt : 60;
    // anchor.widthPt is the CUSTOMER column width; mirror it to the right
    // half when an older anchor has no company line recorded.
    const customerColWidth = anchor ? anchor.widthPt : (pageW - 120) / 2;
    const mirroredRightX = anchor
      ? Math.max(fallbackBlockLeftX + customerColWidth + 24, pageW - fallbackBlockLeftX - customerColWidth)
      : fallbackBlockLeftX + customerColWidth + 24;

    let companySigBox: Box = anchor?.companySig ?? {
      xPt: mirroredRightX,
      yPt: fallbackBlockBottomY,
      widthPt: customerColWidth,
    };
    let companyDateBox: Box | null = anchor?.companyDate ?? null;
    // Some older estimates stored a missing or centered company line, which
    // put the rep signature over the "Your Investment" total. Only those are
    // pushed to the far right; a verified right-hand company line is used as is.
    if (!anchor?.companySig || companySigBox.xPt < pageW * 0.5) {
      const farRightInset = 34;
      const repColumnWidth = Math.min(companySigBox.widthPt, 140);
      const rightColumnX = Math.max(pageW * 0.70, pageW - farRightInset - repColumnWidth);
      companySigBox = { ...companySigBox, xPt: Math.max(companySigBox.xPt, rightColumnX), widthPt: repColumnWidth };
      if (companyDateBox) {
        companyDateBox = {
          ...companyDateBox,
          xPt: Math.max(companyDateBox.xPt, companySigBox.xPt + 24),
          widthPt: Math.min(companyDateBox.widthPt, Math.max(40, pageW - companySigBox.xPt - farRightInset)),
        };
      }
    }

    const repName = [repProfile.first_name, repProfile.last_name].filter(Boolean).join(' ').trim() || repProfile.email || 'Representative';
    const today = new Date();
    const signedDateStr = today.toLocaleDateString();

    // Decode signature data URL → bytes
    const rawSig = repProfile.signature_image_path;
    let sigBytes: Uint8Array | null = null;
    let isPng = true;
    try {
      if (rawSig.startsWith('data:image')) {
        isPng = rawSig.startsWith('data:image/png');
        sigBytes = dataUrlToBytes(rawSig);
      } else {
        const { data: imgBlob } = await supabase.storage.from('documents').download(rawSig);
        if (imgBlob) {
          sigBytes = new Uint8Array(await imgBlob.arrayBuffer());
          isPng = rawSig.toLowerCase().endsWith('.png');
        }
      }
    } catch (e) {
      console.error('Failed to decode rep signature:', e);
    }

    if (!sigBytes) {
      return errorResponse('NO_SIGNATURE', 'Saved signature could not be loaded', 400);
    }

    const embeddedImg = await embedSignatureImage(pdfDoc, sigBytes, isPng);
    stampSignature(page, fonts, { sig: companySigBox, date: companyDateBox }, {
      image: embeddedImg,
      dateText: signedDateStr,
      auditText: `${repName} — ${tenantName}  •  IP: ${ip || 'N/A'}`,
    });

    if (repairedPlacement && anchor && linkedEstimateRow?.id) {
      await supabase.from('enhanced_estimates').update({ signature_anchor: anchor }).eq('id', linkedEstimateRow.id);
      await supabase.from('signature_envelopes').update({ signature_page_index: anchor.pageIndex }).eq('id', envelope.id);
    }

    const finalBytes = await pdfDoc.save();
    const finalPath = `${envelope.tenant_id}/${envelope.id}/countersigned_${Date.now()}.pdf`;

    const { error: upErr } = await supabase.storage
      .from('documents')
      .upload(finalPath, finalBytes, {
        contentType: 'application/pdf',
        upsert: true,
      });
    if (upErr) {
      console.error('Failed to upload countersigned PDF:', upErr);
      return errorResponse('STORAGE_ERROR', 'Could not save countersigned PDF', 500);
    }

    // Hash + complete envelope
    const finalHash = await hashToken(`${envelope.id}:${finalPath}:${Date.now()}`);
    const completedAt = new Date().toISOString();

    await supabase
      .from('signature_envelopes')
      .update({
        status: 'completed',
        completed_at: completedAt,
        countersigned_at: completedAt,
        final_pdf_hash: finalHash,
        signed_pdf_path: finalPath,
      })
      .eq('id', envelope.id);

    // 30-day signed URL
    let downloadUrl = '';
    try {
      const { data: signedUrlData } = await supabase.storage
        .from('documents')
        .createSignedUrl(finalPath, 60 * 60 * 24 * 30);
      if (signedUrlData?.signedUrl) {
        downloadUrl = signedUrlData.signedUrl;
        await supabase
          .from('signature_envelopes')
          .update({ document_url: downloadUrl })
          .eq('id', envelope.id);
      }
    } catch (e) {
      console.error('signed url err', e);
    }

    // Create / update documents row
    let documentId: string | null = null;
    try {
      const { data: docRecord } = await supabase
        .from('documents')
        .insert({
          tenant_id: envelope.tenant_id,
          pipeline_entry_id: envelope.pipeline_entry_id,
          filename: `${envelope.title || 'Document'} (Fully Signed).pdf`,
          file_path: finalPath,
          file_size: finalBytes.byteLength,
          mime_type: 'application/pdf',
          document_type: 'contract',
          description: `Fully signed on ${signedDateStr} — client + ${repName}`,
          uploaded_by: callerId,
        })
        .select('id')
        .single();
      documentId = docRecord?.id ?? null;
    } catch (e) {
      console.error('documents insert err', e);
    }

    // Mark linked estimate as signed
    try {
      const { data: linkedEstimate } = await supabase
        .from('enhanced_estimates')
        .select('id')
        .eq('signature_envelope_id', envelope.id)
        .maybeSingle();
      if (linkedEstimate) {
        await supabase
          .from('enhanced_estimates')
          .update({ status: 'signed', signed_at: completedAt })
          .eq('id', linkedEstimate.id);
      }
    } catch (e) {
      console.error('estimate update err', e);
    }

    // Notify sender on normal countersigns. Force rebuilds are silent repairs
    // of an existing artifact and should not re-notify or re-email customers.
    if (!body.force_rebuild) {
      await createNotification(supabase, {
        tenant_id: envelope.tenant_id,
        user_id: envelope.created_by,
        type: 'envelope_completed',
        title: 'Envelope Completed',
        message: `"${envelope.title}" has been fully signed.`,
        metadata: {
          envelope_id: envelope.id,
          completed_at: completedAt,
          signed_pdf_path: finalPath,
          document_id: documentId,
          action_url: `/signature-envelopes/${envelope.id}`,
        },
      });
    }

    // Email all parties (recipients + sender + countersigner)
    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
    if (RESEND_API_KEY && downloadUrl && !body.force_rebuild) {
      try {
        const { data: recipients } = await supabase
          .from('signature_recipients')
          .select('recipient_name, recipient_email, signed_at')
          .eq('envelope_id', envelope.id);

        const { data: emailDomain } = await supabase
          .from('company_email_domains')
          .select('*')
          .eq('tenant_id', envelope.tenant_id)
          .eq('verification_status', 'verified')
          .eq('is_active', true)
          .maybeSingle();

        const fromDomain = Deno.env.get('RESEND_FROM_DOMAIN') || 'resend.dev';
        const fromEmail = emailDomain?.from_email || `signatures@${fromDomain}`;
        const fromName = emailDomain?.from_name || tenantName;

        const rowsHtml = (recipients || []).map(r => `
          <tr>
            <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:14px;">${r.recipient_name || ''}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:14px;">${r.recipient_email || ''}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:14px;">${r.signed_at ? new Date(r.signed_at).toLocaleString() : ''}</td>
          </tr>`).join('') + `
          <tr>
            <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:14px;"><strong>${repName}</strong> (Rep)</td>
            <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:14px;">${repProfile.email || ''}</td>
            <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:14px;">${new Date(completedAt).toLocaleString()}</td>
          </tr>`;

        const html = `
<!DOCTYPE html><html><body style="font-family:-apple-system,sans-serif;background:#f4f4f5;padding:40px 20px;">
  <table style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;padding:0;">
    <tr><td style="background:linear-gradient(135deg,#16a34a 0%,#15803d 100%);padding:32px 40px;text-align:center;color:#fff;">
      <h1 style="margin:0;font-size:22px;">✅ Document Fully Signed</h1>
    </td></tr>
    <tr><td style="padding:32px 40px;color:#374151;">
      <p>All parties have signed <strong>"${envelope.title || 'Document'}"</strong>. A fully countersigned copy is available below.</p>
      <table style="width:100%;border:1px solid #e5e7eb;border-collapse:collapse;margin:16px 0;">
        <thead><tr style="background:#f9fafb;">
          <th style="padding:8px 12px;text-align:left;font-size:12px;color:#6b7280;">NAME</th>
          <th style="padding:8px 12px;text-align:left;font-size:12px;color:#6b7280;">EMAIL</th>
          <th style="padding:8px 12px;text-align:left;font-size:12px;color:#6b7280;">SIGNED AT</th>
        </tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
      <p style="text-align:center;margin:24px 0;">
        <a href="${downloadUrl}" style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;padding:14px 28px;border-radius:8px;font-weight:600;">Download Signed Document</a>
      </p>
      <p style="color:#9ca3af;font-size:12px;">Document Hash: ${finalHash.substring(0,32)}…</p>
    </td></tr>
  </table>
</body></html>`;

        const emails = new Set<string>();
        for (const r of recipients || []) if (r.recipient_email) emails.add(r.recipient_email);
        if (repProfile.email) emails.add(repProfile.email);
        if (envelope.created_by && envelope.created_by !== callerId) {
          const { data: senderProfile } = await supabase
            .from('profiles')
            .select('email')
            .eq('id', envelope.created_by)
            .maybeSingle();
          if (senderProfile?.email) emails.add(senderProfile.email);
        }

        for (const to of emails) {
          try {
            await fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${RESEND_API_KEY}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                from: `${fromName} <${fromEmail}>`,
                to: [to],
                subject: `✅ Fully Signed: ${envelope.title || 'Document'}`,
                html,
              }),
            });
          } catch (e) {
            console.error(`email fail ${to}`, e);
          }
        }
      } catch (e) {
        console.error('email block err', e);
      }
    }

    await logAuditEvent(supabase, {
      tenant_id: envelope.tenant_id,
      actor_user_id: callerId,
      action: 'envelope.countersigned',
      target_type: 'signature_envelope',
      target_id: envelope.id,
      ip_address: ip,
      user_agent: userAgent,
      changes: {
        final_pdf_hash: finalHash,
        signed_pdf_path: finalPath,
        document_id: documentId,
        rep_name: repName,
      },
    });

    return successResponse({
      envelope_id: envelope.id,
      status: 'completed',
      completed_at: completedAt,
      final_pdf_hash: finalHash,
      signed_pdf_path: finalPath,
      document_id: documentId,
    });
  } catch (e) {
    console.error('countersign-envelope error:', e);
    return errorResponse('INTERNAL_ERROR', 'Internal server error', 500);
  }
});
