import jsPDF from 'jspdf';
import { format } from 'date-fns';
import type { CustomerPhoto } from '@/hooks/usePhotos';

interface PhotoReportOptions {
  photos: CustomerPhoto[];
  title?: string;
  propertyAddress?: string;
  companyName?: string;
  filename?: string;
}

async function loadImage(url: string): Promise<HTMLImageElement | null> {
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
  filename,
}: PhotoReportOptions): Promise<void> {
  if (!photos.length) throw new Error('No photos to export');

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'letter' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();
  const margin = 12;

  // Cover header
  pdf.setFont('helvetica', 'bold');
  pdf.setFontSize(20);
  pdf.text(title, margin, margin + 6);
  pdf.setFont('helvetica', 'normal');
  pdf.setFontSize(10);
  let y = margin + 12;
  if (companyName) {
    pdf.text(companyName, margin, y);
    y += 5;
  }
  if (propertyAddress) {
    pdf.text(propertyAddress, margin, y);
    y += 5;
  }
  pdf.setTextColor(120);
  pdf.text(`Generated ${format(new Date(), 'PPp')}  •  ${photos.length} photo${photos.length !== 1 ? 's' : ''}`, margin, y);
  pdf.setTextColor(0);
  y += 6;
  pdf.setDrawColor(220);
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

    const img = await loadImage(photo.file_url);
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
    pdf.setTextColor(90);
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
    pdf.setTextColor(140);
    pdf.text(`Page ${p} of ${pageCount}`, pageW - margin, pageH - 6, { align: 'right' });
  }

  const safeTitle = (filename || title).replace(/[^\w\-]+/g, '_');
  pdf.save(`${safeTitle}_${format(new Date(), 'yyyyMMdd_HHmm')}.pdf`);
}
