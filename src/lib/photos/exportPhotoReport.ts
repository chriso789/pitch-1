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
  if (directPath && !/^https?:\/\//i.test(directPath)) {
    return decodeURIComponent(directPath).replace(/^\/+/, '');
  }

  const urlValue = directPath || photo.file_url;
  if (!urlValue) return null;

  try {
    const parsed = new URL(urlValue);
    const match = parsed.pathname.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/customer-photos\/(.+)$/);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
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

async function normalizeReportImageBlob(blob: Blob, source?: string | null): Promise<Blob> {
  if (!isHeicSource(source, blob)) return blob;

  const converted = await heic2any({
    blob,
    toType: 'image/jpeg',
    quality: 0.85,
  });
  return Array.isArray(converted) ? converted[0] : converted;
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
        const displayBlob = await normalizeReportImageBlob(data, storagePath);
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
      const displayBlob = await normalizeReportImageBlob(blob, url);
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

  // Header band with tenant logo (if available) + title
  const headerH = 22;
  let logoDrawnW = 0;
  if (companyLogoUrl) {
    try {
      const logoImg = await loadImage(companyLogoUrl);
      if (logoImg) {
        const maxH = 16;
        const maxW = 42;
        const r = logoImg.naturalWidth / logoImg.naturalHeight;
        let w = maxH * r;
        let h = maxH;
        if (w > maxW) {
          w = maxW;
          h = maxW / r;
        }
        const dataUrl = imageToJpegDataUrl(logoImg, 600, 0.9);
        pdf.addImage(dataUrl, 'JPEG', margin, margin, w, h, undefined, 'FAST');
        logoDrawnW = w + 4;
      }
    } catch (e) {
      console.warn('Logo embed failed', e);
    }
  }

  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(18);
  pdf.text(title, margin + logoDrawnW, margin + 7);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  let y = margin + 13;
  if (companyName) {
    pdf.text(companyName, margin + logoDrawnW, y);
    y += 4.5;
  }
  const contactLine = [companyPhone, companyEmail].filter(Boolean).join('  •  ');
  if (contactLine) {
    pdf.setTextColor(110, 110, 110);
    pdf.text(contactLine, margin + logoDrawnW, y);
    pdf.setTextColor(0);
    y += 4.5;
  }
  y = Math.max(y, margin + headerH);
  if (propertyAddress) {
    pdf.setFontSize(10);
    pdf.text(propertyAddress, margin, y);
    y += 5;
  }
  pdf.setTextColor(120, 120, 120);
  pdf.setFontSize(9);
  pdf.text(`Generated ${format(new Date(), 'PPp')}  •  ${photos.length} photo${photos.length !== 1 ? 's' : ''}`, margin, y);
  pdf.setTextColor(0);
  y += 4;
  pdf.setDrawColor(220, 220, 220);
  pdf.line(margin, y, pageW - margin, y);
  y += 4;

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
