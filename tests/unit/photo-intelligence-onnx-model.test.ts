import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tryLoadSession, backboneOnlyModel, loadOrt, loadDinoSession, MODEL_URLS } from '@/lib/photo-intelligence/components/onnxModel';
import ortWasmAsset from '@/assets/ort-wasm-simd-threaded-1.30.0.wasm.asset.json';

const mocks = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock('onnxruntime-web/wasm', () => ({ env: { wasm: {} }, InferenceSession: { create: mocks.create } }));

describe('local ONNX model loader', () => {
  beforeEach(() => { vi.unstubAllGlobals(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('uses the hosted matching WASM binary without frame-dependent workers', async () => {
    const ort = await loadOrt();
    expect(ort.env.wasm.wasmPaths).toEqual({ wasm: ortWasmAsset.url });
    expect(ort.env.wasm.numThreads).toBe(1);
    expect(ort.env.wasm.proxy).toBe(false);
    expect(await loadOrt()).toBe(ort);
  });

  it('refuses runtime initialization outside the browser', async () => {
    vi.stubGlobal('window', undefined);
    await expect(loadOrt()).rejects.toThrow('Photo inference requires a browser');
  });

  it('returns null when the weight file is absent — model not installed is a normal state', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));
    expect(await tryLoadSession("/models/photo-intelligence/missing.onnx")).toBeNull();
  });

  it('never throws on network failure — resolves to null instead', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await tryLoadSession("/models/photo-intelligence/missing.onnx")).toBeNull();
  });

  it('loads the hosted DINOv2 asset but reports the canonical save-contract model identity', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true })));
    const session = { inputNames: ['pixel_values'] };
    mocks.create.mockResolvedValue(session);
    const loaded = await loadDinoSession();
    expect(mocks.create).toHaveBeenCalledWith(MODEL_URLS.dinov2Small, { executionProviders: ['wasm'] });
    expect(loaded).toMatchObject({ modelId: 'dinov2-small', session, inputName: 'pixel_values' });
  });

  it('a feature backbone without a segmentation head reports zero regions, never guessed components', async () => {
    const model = backboneOnlyModel({ modelId: 'dinov2-small.onnx', verifiedClasses: [], session: {}, inputName: 'x' });
    const regions = await model.segment({ width: 4, height: 4, data: new Uint8ClampedArray(64) });
    expect(regions).toHaveLength(0);
    expect(model.verifiedClasses).toHaveLength(0);
  });
});
