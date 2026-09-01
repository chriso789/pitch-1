/**
 * Client-side image compression utility.
 * Resizes large images and converts all formats (including HEIC) to JPEG
 * before uploading, preventing edge function memory crashes.
 *
 * HEIC decoding is delegated to the shared, concurrency-limited decoder so that
 * batch uploads never overwhelm the browser and silently store raw HEIC files.
 */
import { heicToJpegBlob, isHeicFile } from '@/lib/heicDecode';

const DEFAULT_MAX_DIMENSION = 2000;
const DEFAULT_QUALITY = 0.85;

/**
 * Compress and normalize an image file to JPEG.
 * - Converts HEIC/HEIF to JPEG (multi-strategy, queued)
 * - Resizes to fit within maxDimension on longest side
 * - Converts PNG/WebP/etc to JPEG
 * - Typical output: 200-500KB from a 5-10MB iPhone photo
 */
export async function compressImage(
  file: File,
  maxDimension: number = DEFAULT_MAX_DIMENSION,
  quality: number = DEFAULT_QUALITY
): Promise<File> {
  // Skip non-image files
  if (!file.type.startsWith('image/') && !isHeicFile(file)) {
    return file;
  }

  const heic = isHeicFile(file);

  try {
    // Convert HEIC/HEIF to JPEG blob first
    let imageBlob: Blob = file;
    if (heic) {
      imageBlob = await heicToJpegBlob(file, quality);
      console.log(`[imageCompression] HEIC converted: ${(file.size / 1024).toFixed(0)}KB → ${(imageBlob.size / 1024).toFixed(0)}KB`);
    }

    const bitmap = await createImageBitmap(imageBlob);

    // Calculate new dimensions
    let { width, height } = bitmap;
    if (width > maxDimension || height > maxDimension) {
      const ratio = Math.min(maxDimension / width, maxDimension / height);
      width = Math.round(width * ratio);
      height = Math.round(height * ratio);
    }

    // Draw to canvas
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas context unavailable');
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    // Export as JPEG blob
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('Canvas toBlob failed'))),
        'image/jpeg',
        quality
      );
    });

    // Build new filename with .jpg extension
    const baseName = file.name.replace(/\.[^.]+$/, '');
    const compressedFile = new File([blob], `${baseName}.jpg`, {
      type: 'image/jpeg',
      lastModified: Date.now(),
    });

    console.log(
      `[imageCompression] ${file.name}: ${(file.size / 1024).toFixed(0)}KB → ${(compressedFile.size / 1024).toFixed(0)}KB (${width}×${height})`
    );

    return compressedFile;
  } catch (err) {
    console.warn('[imageCompression] Compression failed:', err);

    if (heic) {
      // Last resort for HEIC: convert without resizing rather than storing an
      // undisplayable HEIC in the bucket.
      try {
        const jpegBlob = await heicToJpegBlob(file, quality);
        const baseName = file.name.replace(/\.[^.]+$/, '');
        return new File([jpegBlob], `${baseName}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
      } catch (heicErr) {
        console.error('[imageCompression] HEIC conversion failed entirely:', heicErr);
        throw new Error(
          `${file.name} is a HEIC photo this browser can't convert. Set iPhone Camera → Formats to "Most Compatible", or re-upload as JPEG.`
        );
      }
    }

    return file;
  }
}

export { isHeicFile };

