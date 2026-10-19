import { imageSize } from 'npm:image-size@2';

export async function originalImageIdentity(bytes: Uint8Array) {
  if (!bytes.length || bytes.length > 15 * 1024 * 1024) throw new Error('Invalid original size');
  const image = imageSize(bytes);
  if (!['jpg', 'png', 'webp'].includes(image.type ?? '') || !image.width || !image.height) throw new Error('Unsupported original image');
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes)))).map((v) => v.toString(16).padStart(2, '0')).join('');
  return { hash, w: image.width, h: image.height };
}