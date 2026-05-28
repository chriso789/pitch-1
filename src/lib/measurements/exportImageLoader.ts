// ============================================================================
// exportImageLoader
// ----------------------------------------------------------------------------
// Pure helpers used by the PDF export path to (a) pre-resolve a raster image
// to a data: URL so html2canvas can safely rasterize it even when the
// upstream host (e.g. Google Static Maps) blocks tainted canvas reads, and
// (b) await every <img> / <svg><image> inside the PDF root before capture so
// the exporter never snapshots a half-loaded overlay.
//
// Display/export-only. No backend, no geometry, no gate logic.
// ============================================================================

export type ImageState = "loaded" | "error" | "timeout" | "not_mounted";

export interface FetchAsDataUrlResult {
  state: "loaded" | "error" | "timeout";
  dataUrl?: string;
  error?: string;
}

export interface ImageWaitStatus {
  selector: string;
  src_type: "google_static_map" | "mapbox" | "data_url" | "remote_url" | "placeholder";
  state: ImageState;
  error?: string;
}

function classifySrc(src: string): ImageWaitStatus["src_type"] {
  if (!src) return "placeholder";
  if (src.startsWith("data:")) return "data_url";
  if (src.includes("maps.googleapis.com")) return "google_static_map";
  if (src.includes("api.mapbox.com")) return "mapbox";
  return "remote_url";
}

/**
 * Fetch a remote image and convert it to a data: URL. Returns a structured
 * result rather than throwing, so callers can degrade to a placeholder
 * without aborting the export.
 */
export async function fetchAsDataUrl(
  url: string | null | undefined,
  opts: { timeoutMs?: number } = {},
): Promise<FetchAsDataUrlResult> {
  const timeoutMs = opts.timeoutMs ?? 5000;
  if (!url) return { state: "error", error: "no_url" };
  if (url.startsWith("data:")) return { state: "loaded", dataUrl: url };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { mode: "cors", signal: controller.signal });
    if (!res.ok) {
      return { state: "error", error: `http_${res.status}` };
    }
    const blob = await res.blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result ?? ""));
      r.onerror = () => reject(new Error("reader_error"));
      r.readAsDataURL(blob);
    });
    return { state: "loaded", dataUrl };
  } catch (e: any) {
    if (e?.name === "AbortError") return { state: "timeout" };
    return { state: "error", error: String(e?.message ?? e) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Await every <img> and <svg><image> inside `root`. Each image resolves
 * independently to loaded/error/timeout; aggregate resolves once all have
 * settled or the per-image timeout fires.
 */
export async function waitForImagesInRoot(
  root: HTMLElement | null,
  opts: { timeoutMs?: number } = {},
): Promise<ImageWaitStatus[]> {
  if (!root) return [];
  const timeoutMs = opts.timeoutMs ?? 5000;

  const htmlImgs = Array.from(root.querySelectorAll("img")) as HTMLImageElement[];
  const svgImgs = Array.from(root.querySelectorAll("image")) as SVGImageElement[];

  const tasks: Array<Promise<ImageWaitStatus>> = [];

  for (const img of htmlImgs) {
    const src = img.currentSrc || img.src || "";
    const selector = `img[src^="${src.slice(0, 48)}"]`;
    const src_type = classifySrc(src);
    if (!src) {
      tasks.push(Promise.resolve({ selector, src_type, state: "not_mounted" }));
      continue;
    }
    if (img.complete && img.naturalWidth > 0) {
      tasks.push(Promise.resolve({ selector, src_type, state: "loaded" }));
      continue;
    }
    if (img.complete && img.naturalWidth === 0) {
      tasks.push(
        Promise.resolve({ selector, src_type, state: "error", error: "naturalWidth_0" }),
      );
      continue;
    }
    tasks.push(
      new Promise<ImageWaitStatus>((resolve) => {
        const to = setTimeout(
          () => resolve({ selector, src_type, state: "timeout" }),
          timeoutMs,
        );
        img.addEventListener(
          "load",
          () => {
            clearTimeout(to);
            resolve({ selector, src_type, state: "loaded" });
          },
          { once: true },
        );
        img.addEventListener(
          "error",
          () => {
            clearTimeout(to);
            resolve({ selector, src_type, state: "error", error: "load_event" });
          },
          { once: true },
        );
      }),
    );
  }

  for (const node of svgImgs) {
    const href =
      node.getAttribute("href") || node.getAttribute("xlink:href") || "";
    const selector = `svg image[href^="${href.slice(0, 48)}"]`;
    const src_type = classifySrc(href);
    if (!href) {
      tasks.push(Promise.resolve({ selector, src_type, state: "not_mounted" }));
      continue;
    }
    // SVG <image> has no reliable load event across browsers when fed a
    // data: URL it has already painted, so we treat any mounted href as
    // present. Real image-load failures are caught by the html <img>
    // pathway (the PDF section uses an <img> for the aerial when possible).
    tasks.push(Promise.resolve({ selector, src_type, state: "loaded" }));
  }

  return Promise.all(tasks);
}
