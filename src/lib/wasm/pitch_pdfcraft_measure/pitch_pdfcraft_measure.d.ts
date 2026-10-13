/* tslint:disable */
/* eslint-disable */

/**
 * Writes a standard ISO 32000 measurement annotation (incremental save). Returns new PDF bytes;
 * throws a JS error with the engine message on invalid geometry/scale.
 */
export function add_measurement(pdf: Uint8Array, json_in: string): Uint8Array;

export function calibrate(ax: number, ay: number, bx: number, by: number, real: number, unit: string, precision: number): string;

export function engine_version(): string;

/**
 * Measurement annotations already saved inside the PDF.
 */
export function list(pdf: Uint8Array): string;

/**
 * Vector geometry snapshot for a page (segments/endpoints/midpoints in user space).
 */
export function page_geometry(pdf: Uint8Array, page: number): string;

export function reading(kind_name: string, points_json: string, scale_json: string): string;

export function snap(pdf: Uint8Array, page: number, x: number, y: number, tolerance: number): string;

export function user_to_view(pdf: Uint8Array, page: number, x: number, y: number): string;

/**
 * Converts a point between view space (rotation/crop applied, origin top-left of crop box) and PDF user space.
 */
export function view_to_user(pdf: Uint8Array, page: number, x: number, y: number): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly add_measurement: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly calibrate: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number];
    readonly engine_version: () => [number, number];
    readonly list: (a: number, b: number) => [number, number];
    readonly page_geometry: (a: number, b: number, c: number) => [number, number];
    readonly reading: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly snap: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly user_to_view: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly view_to_user: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
