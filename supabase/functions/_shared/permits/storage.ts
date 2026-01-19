// =========================================================
// Permit Document Storage
// Uploads a document to storage + writes permit_documents row + returns signed URL
// =========================================================

import { PermitDocument } from "./types.ts";

type StoreArgs = {
  tenant_id: string;
  permit_case_id: string;
  kind: string;
  title: string;
  bucket: string;
  path: string;
  bytes: Uint8Array;
  contentType: string;
  signedUrlSeconds: number;
};

export async function storeDocumentAndSign(supabase: any, args: StoreArgs): Promise<PermitDocument> {
  // Upload (upsert = true for overwrite)
  const { error: uerr } = await supabase.storage.from(args.bucket).upload(args.path, args.bytes, {
    contentType: args.contentType,
    upsert: true,
  });
  if (uerr) throw uerr;

  // Insert permit_documents record
  const { data: doc, error: derr } = await supabase
    .from("permit_documents")
    .insert({
      tenant_id: args.tenant_id,
      permit_case_id: args.permit_case_id,
      kind: args.kind,
      title: args.title,
      storage_bucket: args.bucket,
      storage_path: args.path,
      meta: { content_type: args.contentType },
    })
    .select("id,kind,title,storage_bucket,storage_path,created_at")
    .single();
  if (derr) throw derr;

  // Generate signed URL
  const { data: signed, error: serr } = await supabase.storage.from(args.bucket).createSignedUrl(
    args.path,
    args.signedUrlSeconds,
  );
  if (serr) throw serr;

  return {
    id: doc.id,
    kind: doc.kind,
    title: doc.title,
    bucket: args.bucket,
    path: args.path,
    signed_url: signed.signedUrl,
    content_type: args.contentType,
  };
}
