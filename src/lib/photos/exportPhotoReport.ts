import jsPDF from 'jspdf';
import { format } from 'date-fns';
import heic2any from 'heic2any';
import type { CustomerPhoto } from '@/hooks/usePhotos';
import { supabase } from '@/integrations/supabase/client';

interface PhotoReportOptions {
  photos: CustomerPhoto[];
  title?: string;
  propertyAddress?: string;
  companyName?: string;
  companyLogoUrl?: string;
  companyPhone?: string;
  companyEmail?: string;
  filename?: string;
  /** 'download' saves via jsPDF.save (default). 'blob' returns { blob, filename, base64 } without saving. */
  output?: 'download' | 'blob';
}

export interface PhotoReportResult {
  blob: Blob;
  base64: string; // without data: prefix
  filename: string;
}

function resolveCustomerPhotoStoragePath(photo: Pick<CustomerPhoto, 'file_name' | 'file_url'>): string | null {
  const directPath = photo.file_name?.trim();
  // New uploads store the full storage object path in file_name, but older
  // rows may have only the original filename there. Treat values without a
  // folder as a filename, then parse the real storage path from file_url.
  if (directPath && !/^https?:\/\//i.test(directPath) && directPath.includes('/')) {
    return decodeURIComponent(directPath).replace(/^\/+/, '');
  }

  const urlValue = directPath && /^https?:\/\//i.test(directPath) ? directPath : photo.file_url;
  if (!urlValue) return null;

  try {
    const parsed = new URL(urlValue);
    const match = parsed.pathname.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/customer-photos\/(.+)$/);
    if (match?.[1]) return decodeURIComponent(match[1]);
  } catch {
    // fall through
  }

  return directPath && !/^https?:\/\//i.test(directPath)
    ? decodeURIComponent(directPath).replace(/^\/+/, '')
    : null;
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

function isHeicSource(source?: string | null, blob?: Blob | null): boolean {
  const lower = (source || '').toLowerCase();
  const mime = (blob?.type || '').toLowerCase();
  return lower.includes('.heic') || lower.includes('.heif') || mime.includes('heic') || mime.includes('heif');
}

function inferImageMime(source?: string | null): string | null {
  const path = (source || '').split('?')[0].toLowerCase();
  if (/\.jpe?g$/i.test(path)) return 'image/jpeg';
  if (/\.png$/i.test(path)) return 'image/png';
  if (/\.webp$/i.test(path)) return 'image/webp';
  if (/\.gif$/i.test(path)) return 'image/gif';
  return null;
}

async function normalizeReportImageBlob(blob: Blob, source?: string | null): Promise<Blob> {
  if (!isHeicSource(source, blob)) return blob;

  const converted = await heic2any({
    blob,
    toType: 'image/jpeg',
    quality: 0.85,
  });
  return Array.isArray(converted) ? converted[0] : converted;
}

function ensureImageMime(blob: Blob, source?: string | null): Blob {
  const currentType = blob.type?.toLowerCase();
  if (currentType?.startsWith('image/')) return blob;

  // Supabase uploads that don't include contentType can come back as
  // application/octet-stream. A data URL with that MIME will not reliably
  // decode in <img>, even though the bytes are a valid JPEG/PNG.
  return new Blob([blob], { type: inferImageMime(source) || 'image/jpeg' });
}

async function loadImage(url: string, storagePath?: string | null): Promise<HTMLImageElement | null> {
  // Fetch/download the image as a blob first so we can inline it as a data URL.
  // This avoids CORS-tainted canvases and fixes private customer-photos URLs
  // whose stored public URL is not directly readable by fetch/img.
  const toImage = (src: string) =>
    new Promise<HTMLImageElement | null>((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });

  if (storagePath) {
    try {
      const { data, error } = await supabase.storage
        .from('customer-photos')
        .download(storagePath);
      if (!error && data) {
        const displayBlob = ensureImageMime(await normalizeReportImageBlob(data, storagePath), storagePath);
        const img = await toImage(await blobToDataUrl(displayBlob));
        if (img) return img;
      }
      if (error) console.warn('Photo storage download failed', storagePath, error.message);
    } catch (e) {
      console.warn('Photo storage download failed', storagePath, e);
    }
  }

  try {
    const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
    if (res.ok) {
      const blob = await res.blob();
      const displayBlob = ensureImageMime(await normalizeReportImageBlob(blob, url), url);
      const dataUrl = await blobToDataUrl(displayBlob);
      const img = await toImage(dataUrl);
      if (img) return img;
    }
  } catch {
    /* fall through to direct load */
  }

  // Fallback: direct load with anonymous CORS
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function imageToJpegDataUrl(img: HTMLImageElement, maxSide = 1400, quality = 0.72): string {
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * scale);
  const h = Math.round(img.naturalHeight * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', quality);
}

const CATEGORY_LABEL: Record<string, string> = {
  before: 'Before',
  after: 'After',
  damage: 'Damage',
  materials: 'Materials',
  inspection: 'Inspection',
  roof: 'Roof',
  general: 'General',
};

export async function exportPhotoReport({
  photos,
  title = 'Photo Report',
  propertyAddress,
  companyName,
  companyLogoUrl,
  companyPhone,
  companyEmail,
  filename,
  output = 'download',
}: PhotoReportOptions): Promise<PhotoReportResult> {
  if (!photos.length) throw new Error('No photos to export');


  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 12;

  // Header: logo left, company info right-aligned, title row, meta row, divider
  const logoBoxH = 14;
  let logoBoxW = 0;
  if (companyLogoUrl) {
    try {
      const logoImg = await loadImage(companyLogoUrl);
      if (logoImg) {
        const r = logoImg.naturalWidth / logoImg.naturalHeight;
        let h = logoBoxH;
        let w = h * r;
        const maxW = 32;
        if (w > maxW) { w = maxW; h = w / r; }
        const dataUrl = imageToJpegDataUrl(logoImg, 600, 0.9);
        pdf.addImage(dataUrl, 'JPEG', margin, margin, w, h, undefined, 'FAST');
        logoBoxW = w + 5;
      }
    } catch (e) {
      console.warn('Logo embed failed', e);
    }
  }

  // Right-aligned company block
  const rightX = pageW - margin;
  let ry = margin + 3.5;
  if (companyName) {
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(10.5);
    pdf.setTextColor(30, 30, 30);
    pdf.text(companyName, rightX, ry, { align: 'right' });
    ry += 4.2;
  }
  const contactLine = [companyPhone, companyEmail].filter(Boolean).join('  •  ');
  if (contactLine) {
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8.5);
    pdf.setTextColor(120, 120, 120);
    pdf.text(contactLine, rightX, ry, { align: 'right' });
  }
  pdf.setTextColor(0);

  // Title row (below logo)
  let y = margin + logoBoxH + 6;
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(17);
  pdf.text(title, margin, y);
  y += 6;

  // Meta row: address + generated info
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(9);
  pdf.setTextColor(110, 110, 110);
  const metaBits = [
    propertyAddress,
    `${photos.length} photo${photos.length !== 1 ? 's' : ''}`,
    `Generated ${format(new Date(), 'PP')}`,
  ].filter(Boolean);
  pdf.text(metaBits.join('  •  '), margin, y);
  pdf.setTextColor(0);
  y += 4;

  pdf.setDrawColor(225, 225, 225);
  pdf.setLineWidth(0.3);
  pdf.line(margin, y, pageW - margin, y);
  y += 5;

  // 2 photos per row
  const cols = 2;
  const gap = 6;
  const cellW = (pageW - margin * 2 - gap * (cols - 1)) / cols;
  const cellH = 78; // image area
  const captionH = 16;
  const rowH = cellH + captionH + 4;

  let col = 0;
  let rowTop = y;

  for (let i = 0; i < photos.length; i++) {
    const photo = photos[i];

    if (col === 0 && rowTop + rowH > pageH - margin) {
      pdf.addPage();
      rowTop = margin;
    }

    const x = margin + col * (cellW + gap);
    const yImg = rowTop;

    // Placeholder frame
    pdf.setDrawColor(200, 200, 200);
    pdf.setFillColor(245, 245, 245);
    pdf.rect(x, yImg, cellW, cellH, 'FD');

    const img = await loadImage(photo.file_url, resolveCustomerPhotoStoragePath(photo));
    if (img) {
      try {
        const dataUrl = imageToJpegDataUrl(img);
        const ratio = img.naturalWidth / img.naturalHeight;
        const cellRatio = cellW / cellH;
        let drawW = cellW;
        let drawH = cellH;
        if (ratio > cellRatio) {
          drawH = cellW / ratio;
        } else {
          drawW = cellH * ratio;
        }
        const dx = x + (cellW - drawW) / 2;
        const dy = yImg + (cellH - drawH) / 2;
        pdf.addImage(dataUrl, 'JPEG', dx, dy, drawW, drawH, undefined, 'FAST');
      } catch (e) {
        console.warn('Photo embed failed', e);
      }
    }

    // Caption
    const capY = yImg + cellH + 4;
    pdf.setFontSize(9);
    pdf.setFont('helvetica', 'bold');
    const cat = photo.category ? CATEGORY_LABEL[photo.category] ?? photo.category : 'Photo';
    pdf.text(`${i + 1}. ${cat}`, x, capY);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(90, 90, 90);
    const takenAt = photo.taken_at || photo.uploaded_at || photo.created_at;
    const dateStr = takenAt ? format(new Date(takenAt), 'PP p') : '';
    if (dateStr) pdf.text(dateStr, x, capY + 4);
    if (photo.gps_latitude != null && photo.gps_longitude != null) {
      pdf.text(
        `GPS ${photo.gps_latitude.toFixed(5)}, ${photo.gps_longitude.toFixed(5)}`,
        x,
        capY + 8,
      );
    }
    if (photo.description) {
      const desc = pdf.splitTextToSize(photo.description, cellW);
      pdf.text(desc.slice(0, 1), x, capY + 12);
    }
    pdf.setTextColor(0);

    col++;
    if (col >= cols) {
      col = 0;
      rowTop += rowH;
    }
  }

  // Footer page numbers
  const pageCount = pdf.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    pdf.setPage(p);
    pdf.setFontSize(8);
    pdf.setTextColor(140, 140, 140);
    pdf.text(`Page ${p} of ${pageCount}`, pageW - margin, pageH - 6, { align: 'right' });
  }

  const safeTitle = (filename || title).replace(/[^\w\-]+/g, '_');
  const outName = `${safeTitle}_${format(new Date(), 'yyyyMMdd_HHmm')}.pdf`;

  const blob = pdf.output('blob') as Blob;
  // Extract base64 from data URI (arraybuffer -> base64 without prefix)
  const arrayBuf = pdf.output('arraybuffer') as ArrayBuffer;
  const bytes = new Uint8Array(arrayBuf);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)));
  }
  const base64 = btoa(binary);

  if (output === 'download') {
    pdf.save(outName);
  }

  return { blob, base64, filename: outName };
}
