/**
 * Download helpers for photos. Always converts the source image to a JPEG blob
 * and triggers a real browser download (instead of navigating to the storage URL,
 * which can render as a broken/blocked page).
 */

const sanitize = (name: string) =>
  name.replace(/[^a-z0-9-_ .]/gi, '_').replace(/\s+/g, '-').slice(0, 80);

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

async function toJpegBlob(src: string): Promise<Blob> {
  // Try a direct fetch first — same-origin/CORS-enabled storage returns the bytes.
  let sourceBlob: Blob | null = null;
  try {
    const res = await fetch(src, { mode: 'cors' });
    if (res.ok) sourceBlob = await res.blob();
  } catch {
    sourceBlob = null;
  }

  if (sourceBlob && sourceBlob.type === 'image/jpeg') return sourceBlob;

  const objectUrl = sourceBlob ? URL.createObjectURL(sourceBlob) : src;
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.crossOrigin = 'anonymous';
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Unable to load image'));
      el.src = objectUrl;
    });

    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas unsupported');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.92)
    );
    if (!blob) throw new Error('Conversion failed');
    return blob;
  } finally {
    if (sourceBlob) URL.revokeObjectURL(objectUrl);
  }
}

export async function downloadPhotoAsJpeg(
  photo: { file_url: string; original_filename?: string | null; id?: string },
  index?: number
): Promise<void> {
  const base = photo.original_filename
    ? photo.original_filename.replace(/\.[^.]+$/, '')
    : `photo-${index != null ? index + 1 : (photo.id || 'download').slice(0, 8)}`;
  const blob = await toJpegBlob(photo.file_url);
  triggerDownload(blob, `${sanitize(base)}.jpg`);
}

export async function downloadPhotosAsJpeg(
  photos: Array<{ file_url: string; original_filename?: string | null; id?: string }>
): Promise<{ ok: number; failed: number }> {
  let ok = 0;
  let failed = 0;
  for (let i = 0; i < photos.length; i++) {
    try {
      await downloadPhotoAsJpeg(photos[i], i);
      ok++;
      // Small gap so browsers don't drop rapid successive downloads.
      await new Promise((r) => setTimeout(r, 250));
    } catch (err) {
      console.error('[downloadPhotosAsJpeg] failed', photos[i]?.file_url, err);
      failed++;
    }
  }
  return { ok, failed };
}
