// Deterministic PDF text extractor using unpdf (Deno-native, no canvas dep).
// Used by pdf-api and document-worker. NEVER calls an AI provider.

import { extractText, getDocumentProxy } from "https://esm.sh/unpdf@0.12.1";

export interface PdfTextResult {
  page_count: number;
  full_text: string;
  pages: string[];           // index = page_number - 1
  total_chars: number;
  has_selectable_text: boolean;  // false → caller should mark for OCR
}

const MIN_CHARS_PER_PAGE = 40;  // below this we treat the page as image-only

export async function extractPdfText(bytes: Uint8Array): Promise<PdfTextResult> {
  const pdf = await getDocumentProxy(bytes);
  const page_count: number = pdf.numPages;
  const { text } = await extractText(pdf, { mergePages: false });
  const pages: string[] = Array.isArray(text) ? text.map(String) : [String(text)];
  const full_text = pages.join("\n\n");
  const total_chars = full_text.replace(/\s+/g, "").length;
  const avg_per_page = page_count > 0 ? total_chars / page_count : 0;
  return {
    page_count,
    full_text,
    pages,
    total_chars,
    has_selectable_text: avg_per_page >= MIN_CHARS_PER_PAGE,
  };
}

export async function downloadStorageObject(
  supabase: { storage: { from: (b: string) => { download: (p: string) => Promise<{ data: Blob | null; error: unknown }> } } },
  bucket: string,
  path: string,
): Promise<Uint8Array> {
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error || !data) throw new Error(`storage_download_failed: ${String(error)}`);
  return new Uint8Array(await data.arrayBuffer());
}
