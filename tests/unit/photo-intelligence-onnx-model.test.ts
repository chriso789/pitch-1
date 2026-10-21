import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tryLoadSession, backboneOnlyModel, loadOrt } from '@/lib/photo-intelligence/components/onnxModel';
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';

vi.mock('onnxruntime-web/wasm', () => ({ env: { wasm: {} } }));

describe('local ONNX model loader', () => {
  beforeEach(() => { vi.unstubAllGlobals(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('uses the bundled matching WASM binary without frame-dependent workers', async () => {
    const ort = await loadOrt();
    expect(ort.env.wasm.wasmPaths).toEqual({ wasm: ortWasmUrl });
    expect(ort.env.wasm.numThreads).toBe(1);
    expect(ort.env.wasm.proxy).toBe(false);
    expect(await loadOrt()).toBe(ort);
  });

  it('returns null when the weight file is absent — model not installed is a normal state', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));
    expect(await tryLoadSession("/models/photo-intelligence/missing.onnx")).toBeNull();
  });

  it('never throws on network failure — resolves to null instead', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    expect(await tryLoadSession("/models/photo-intelligence/missing.onnx")).toBeNull();
  });

  it('a feature backbone without a segmentation head reports zero regions, never guessed components', async () => {
    const model = backboneOnlyModel({ modelId: 'dinov2-small.onnx', verifiedClasses: [], session: {}, inputName: 'x' });
    const regions = await model.segment({ width: 4, height: 4, data: new Uint8ClampedArray(64) });
    expect(regions).toHaveLength(0);
    expect(model.verifiedClasses).toHaveLength(0);
  });
});
