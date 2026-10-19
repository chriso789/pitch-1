import { Image } from 'npm:imagescript@1.3.0';

export async function originalImageIdentity(bytes: Uint8Array) {
  if (!bytes.length || bytes.length > 15 * 1024 * 1024) throw new Error('Invalid original size');
  const image = await Image.decode(bytes);
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map((v) => v.toString(16).padStart(2, '0')).join('');
  return { hash, w: image.width, h: image.height };
}