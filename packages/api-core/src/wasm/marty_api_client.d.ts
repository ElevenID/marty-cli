/* tslint:disable */
/* eslint-disable */

export class MartyApiClient {
    free(): void;
    [Symbol.dispose](): void;
    apiRequest(endpoint: string, options: any): Promise<any>;
    delete(endpoint: string, options: any): Promise<any>;
    fetchWithRetry(url: string, options: any, retry_config: any): Promise<Response>;
    get(endpoint: string, options: any): Promise<any>;
    constructor(base_url: string, request_options?: Function | null);
    patch(endpoint: string, data: any, options: any): Promise<any>;
    post(endpoint: string, data: any, options: any): Promise<any>;
    put(endpoint: string, data: any, options: any): Promise<any>;
    reportClientError(report: any): Promise<any>;
}

export function getErrorCode(error: any): string | undefined;

export function getErrorMessage(error: any): string;

export function handleApiError(error: any): any;

export function isAuthError(error: any): boolean;

export function isRetryableError(error: any): boolean;

export function mipVersion(): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_martyapiclient_free: (a: number, b: number) => void;
    readonly getErrorCode: (a: any) => [number, number];
    readonly getErrorMessage: (a: any) => [number, number];
    readonly handleApiError: (a: any) => any;
    readonly isAuthError: (a: any) => number;
    readonly isRetryableError: (a: any) => number;
    readonly martyapiclient_apiRequest: (a: number, b: number, c: number, d: any) => any;
    readonly martyapiclient_delete: (a: number, b: number, c: number, d: any) => any;
    readonly martyapiclient_fetchWithRetry: (a: number, b: number, c: number, d: any, e: any) => any;
    readonly martyapiclient_get: (a: number, b: number, c: number, d: any) => any;
    readonly martyapiclient_new: (a: number, b: number, c: number) => number;
    readonly martyapiclient_patch: (a: number, b: number, c: number, d: any, e: any) => any;
    readonly martyapiclient_post: (a: number, b: number, c: number, d: any, e: any) => any;
    readonly martyapiclient_put: (a: number, b: number, c: number, d: any, e: any) => any;
    readonly martyapiclient_reportClientError: (a: number, b: any) => any;
    readonly mipVersion: () => [number, number];
    readonly wasm_bindgen__convert__closures_____invoke__ha7949276e3463deb: (a: number, b: number, c: any) => [number, number];
    readonly wasm_bindgen__convert__closures_____invoke__h25b0e9adf71482ab: (a: number, b: number, c: any, d: any) => void;
    readonly wasm_bindgen__convert__closures_____invoke__hd7058d8e349b10c4: (a: number, b: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_destroy_closure: (a: number, b: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
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
