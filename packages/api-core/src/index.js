/**
 * Compatibility surface for the Rust/WASM Marty API client.
 *
 * Request construction, retries, protocol headers, error normalization, and
 * client-error reporting are implemented by `marty-api-client` in Rust. This
 * adapter preserves the established JavaScript factory and Axios-like facade.
 */
import {
  default as initializeWasm,
  MartyApiClient,
  getErrorCode as nativeGetErrorCode,
  getErrorMessage,
  handleApiError,
  isAuthError,
  isRetryableError,
  mipVersion,
} from './wasm/marty_api_client.js';

const wasmUrl = new URL('./wasm/marty_api_client_bg.wasm', import.meta.url);
const nodeFsPromises = ['node:fs', 'promises'].join('/');
const wasmInput = globalThis.process?.versions?.node
  ? await import(/* @vite-ignore */ nodeFsPromises).then(({ readFile }) => readFile(wasmUrl))
  : wasmUrl;
await initializeWasm({ module_or_path: wasmInput });

export const MIP_VERSION = mipVersion();

export { getErrorMessage, handleApiError, isAuthError, isRetryableError };

export function getErrorCode(error) {
  return nativeGetErrorCode(error) ?? null;
}

export function createApiClient({ baseUrl = '', requestOptions = () => ({}) } = {}) {
  const native = new MartyApiClient(baseUrl, requestOptions);
  const fetchWithRetry = (url, options = {}, retryConfig = {}) =>
    native.fetchWithRetry(url, options, retryConfig);
  const apiRequest = (endpoint, options = {}) => native.apiRequest(endpoint, options);
  const get = (endpoint, options = {}) => native.get(endpoint, options);
  const post = (endpoint, data, options = {}) => native.post(endpoint, data, options);
  const put = (endpoint, data, options = {}) => native.put(endpoint, data, options);
  const patch = (endpoint, data, options = {}) => native.patch(endpoint, data, options);
  const del = (endpoint, options = {}) => native.delete(endpoint, options);
  const reportClientError = report => native.reportClientError(report);

  const apiClient = {
    get: async (url, config = {}) => ({ data: await get(url, config) }),
    post: async (url, body, config = {}) => ({ data: await post(url, body, config) }),
    put: async (url, body, config = {}) => ({ data: await put(url, body, config) }),
    patch: async (url, body, config = {}) => ({ data: await patch(url, body, config) }),
    delete: async (url, config = {}) => ({ data: await del(url, config) }),
  };

  return {
    fetchWithRetry,
    apiRequest,
    get,
    post,
    put,
    patch,
    del,
    reportClientError,
    getErrorMessage,
    getErrorCode,
    isAuthError,
    isRetryableError,
    handleApiError,
    apiClient,
  };
}
