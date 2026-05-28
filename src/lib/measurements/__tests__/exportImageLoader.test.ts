import { describe, it, expect } from "vitest";
import { waitForImagesInRoot } from "../exportImageLoader";

function makeRoot(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

describe("exportImageLoader — waitForImagesInRoot", () => {
  it("returns [] for null root", async () => {
    expect(await waitForImagesInRoot(null)).toEqual([]);
  });

  it("reports loaded for an already-complete image", async () => {
    const root = makeRoot('<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=">');
    const img = root.querySelector("img")!;
    // jsdom does not actually decode; force the complete/naturalWidth state.
    Object.defineProperty(img, "complete", { value: true });
    Object.defineProperty(img, "naturalWidth", { value: 1 });
    const states = await waitForImagesInRoot(root);
    expect(states).toHaveLength(1);
    expect(states[0].state).toBe("loaded");
    expect(states[0].src_type).toBe("data_url");
  });

  it("resolves timeout within the configured budget", async () => {
    const root = makeRoot('<img src="https://example.com/never.png">');
    const img = root.querySelector("img")!;
    Object.defineProperty(img, "complete", { value: false });
    Object.defineProperty(img, "naturalWidth", { value: 0 });
    const start = Date.now();
    const states = await waitForImagesInRoot(root, { timeoutMs: 50 });
    expect(Date.now() - start).toBeLessThan(500);
    expect(states[0].state).toBe("timeout");
    expect(states[0].src_type).toBe("remote_url");
  });

  it("classifies google static map srcs", async () => {
    const root = makeRoot(
      '<img src="https://maps.googleapis.com/maps/api/staticmap?center=...">',
    );
    const img = root.querySelector("img")!;
    Object.defineProperty(img, "complete", { value: true });
    Object.defineProperty(img, "naturalWidth", { value: 1 });
    const states = await waitForImagesInRoot(root);
    expect(states[0].src_type).toBe("google_static_map");
  });

  it("treats SVG <image> with href as loaded", async () => {
    const root = makeRoot(
      '<svg><image href="data:image/png;base64,iVBORw0K"></image></svg>',
    );
    const states = await waitForImagesInRoot(root);
    expect(states).toHaveLength(1);
    expect(states[0].state).toBe("loaded");
    expect(states[0].src_type).toBe("data_url");
  });

  it("reports not_mounted for SVG <image> without href", async () => {
    const root = makeRoot('<svg><image></image></svg>');
    const states = await waitForImagesInRoot(root);
    expect(states[0].state).toBe("not_mounted");
  });
});
