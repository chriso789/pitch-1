// Pull QBO attachments (Attachable) for a Payment and mirror them into Pitch
// `documents` so receipts/checks captured in QuickBooks show on the job.
//
// Idempotent on metadata->>qbo_attachable_id. Best-effort: never throws.

import type { SupabaseClient } from "npm:@supabase/supabase-js@2.49.1";
import { qboHost } from "../qbo-host.ts";
import { getValidAccessToken } from "../qbo-auth.ts";
import { qboFetch } from "./retry.ts";
import type { QboConnectionCtx } from "./reconciler.ts";

const BUCKET = "documents";

export async function mirrorQboPaymentAttachments(opts: {
  service: SupabaseClient;
  tenantId: string;
  connection: QboConnectionCtx;
  qboPaymentId: string;
  projectId: string | null;
  docNumberRef?: string | null;
}): Promise<number> {
  const { service, tenantId, connection, qboPaymentId, projectId, docNumberRef } = opts;
  if (!projectId) return 0;

  let mirrored = 0;
  try {
    const query =
      `select * from Attachable where AttachableRef.EntityRef.Type = 'Payment' and AttachableRef.EntityRef.value = '${qboPaymentId}'`;
    const listed = await qboFetch({
      method: "GET",
      url: `${qboHost(connection)}/v3/company/${connection.realm_id}/query?query=${encodeURIComponent(query)}&minorversion=75`,
      getAccessToken: async () => (await getValidAccessToken(service, tenantId)).access_token,
    });
    if (!listed.ok) return 0;

    const attachables = (listed.json as any)?.QueryResponse?.Attachable ?? [];
    for (const att of attachables) {
      const attachableId = String(att?.Id ?? "");
      const downloadUri: string | undefined = att?.TempDownloadUri;
      const fileName: string = att?.FileName ?? `qbo-payment-${qboPaymentId}-${attachableId}`;
      if (!attachableId || !downloadUri) continue;

      const { data: existing } = await service
        .from("documents")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("metadata->>qbo_attachable_id", attachableId)
        .maybeSingle();
      if (existing?.id) continue;

      const fileRes = await fetch(downloadUri);
      if (!fileRes.ok) continue;
      const bytes = new Uint8Array(await fileRes.arrayBuffer());
      const mime = att?.ContentType ?? fileRes.headers.get("content-type") ?? "application/octet-stream";

      // Storage RLS contract: tenant_id must be the first path segment.
      const path = `${tenantId}/quickbooks/payments/${qboPaymentId}/${attachableId}-${fileName}`;
      const { error: upErr } = await service.storage
        .from(BUCKET)
        .upload(path, bytes, { contentType: mime, upsert: true });
      if (upErr) {
        console.error("qbo_attachment_upload_failed", attachableId, upErr.message);
        continue;
      }

      const { error: insErr } = await service.from("documents").insert({
        tenant_id: tenantId,
        project_id: projectId,
        filename: fileName,
        file_path: path,
        file_size: bytes.byteLength,
        mime_type: mime,
        document_type: "payment_receipt",
        description: docNumberRef
          ? `QuickBooks payment attachment (invoice ${docNumberRef})`
          : "QuickBooks payment attachment",
        metadata: {
          source: "quickbooks",
          qbo_attachable_id: attachableId,
          qbo_payment_id: qboPaymentId,
          realm_id: connection.realm_id,
        },
      });
      if (insErr) {
        console.error("qbo_attachment_row_failed", attachableId, insErr.message);
        continue;
      }
      mirrored += 1;
    }
  } catch (e) {
    console.error("qbo_attachment_mirror_failed", qboPaymentId, e instanceof Error ? e.message : String(e));
  }
  return mirrored;
}
