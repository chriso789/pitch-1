/**
 * Native multi-select photo picker for the Capacitor mobile build.
 *
 * Uses @capacitor/camera's `Camera.pickImages` — the underlying iOS/Android
 * picker returns full-resolution originals with EXIF preserved, so our
 * existing geotag-sort in PhotoControlCenter can still bubble on-site
 * photos to the front of the upload queue.
 *
 * NOTE: Neither iOS PhotoKit nor Android MediaStore is queried by GPS here.
 * The OS pickers do not expose "photos near coordinate X" as a filter; the
 * app receives whatever the user picked and re-orders client-side.
 *
 * Returns null on the web (caller should fall back to the <input> path).
 */
import { isNativeApp } from "./appMode";

export async function pickNativePhotos(): Promise<File[] | null> {
  if (!isNativeApp()) return null;
  try {
    const { Camera } = await import("@capacitor/camera");
    const res = await Camera.pickImages({ quality: 92, limit: 0 });
    if (!res?.photos?.length) return [];
    const files: File[] = [];
    for (const p of res.photos) {
      const src = p.webPath || (p.path ? `file://${p.path}` : null);
      if (!src) continue;
      try {
        const blob = await (await fetch(src)).blob();
        const name = `photo_${Date.now()}_${files.length}.${(p.format || "jpg").toLowerCase()}`;
        files.push(new File([blob], name, { type: blob.type || `image/${p.format || "jpeg"}` }));
      } catch (e) {
        console.warn("pickNativePhotos: failed to load", src, e);
      }
    }
    return files;
  } catch (e) {
    console.warn("pickNativePhotos unavailable, falling back to web input", e);
    return null;
  }
}
