/**
 * Client-side image compression utility.
 * Resizes large images and converts all formats (including HEIC) to JPEG
 * before uploading, preventing edge function memory crashes.
 */

const DEFAULT_MAX_DIMENSION = 2000;
const DEFAULT_QUALITY = 0.85;

/**
 * Compress and normalize an image file to JPEG.
 * - Resizes to fit within maxDimension on longest side
 * - Converts HEIC/PNG/WebP/etc to JPEG
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

  try {
    const bitmap = await createImageBitmap(await fileToBlob(file));
    
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
    if (!ctx) {
      console.warn('[imageCompression] Canvas context unavailable, returning original');
      return file;
    }
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
    console.warn('[imageCompression] Compression failed, returning original file:', err);
    return file;
  }
}

function isHeicFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return name.endsWith('.heic') || name.endsWith('.heif') || 
         file.type === 'image/heic' || file.type === 'image/heif';
}

async function fileToBlob(file: File): Promise<Blob> {
  // For HEIC files with empty type, we need to set the type hint
  // Modern browsers (Safari 17+, Chrome 120+) support HEIC natively
  if (isHeicFile(file) && !file.type) {
    return new Blob([await file.arrayBuffer()], { type: 'image/heic' });
  }
  return file;
}
