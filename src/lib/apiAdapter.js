/**
 * CLI API Adapter — Node.js HTTP client backed by @elevenid/marty-api-core.
 *
 * Injects:
 *   • Base URL from config / MARTY_API_URL
 *   • Auth headers (API key or Bearer token) from ~/.marty/credentials.json
 *
 * Re-exports the same {get, post, put, patch, del, apiClient, …} surface
 * so domain commands can consume a consistent API.
 */

import { createApiClient, getErrorMessage, getErrorCode, isAuthError, isRetryableError, handleApiError } from '@elevenid/marty-api-core';
import { loadConfig } from './config.js';
import { getAuthHeaders } from './auth.js';

let _client = null;

function getClient() {
  if (_client) return _client;
  const config = loadConfig();
  _client = createApiClient({
    baseUrl: config.apiUrl,
    requestOptions: () => ({ headers: getAuthHeaders() }),
  });
  return _client;
}

/** Reset the cached client (useful after login / config change). */
export function resetClient() {
  _client = null;
}

// Lazy-forwarding exports — call getClient() on each invocation
// so config/auth changes are picked up.
export function get(...args) { return getClient().get(...args); }
export function post(...args) { return getClient().post(...args); }
export function put(...args) { return getClient().put(...args); }
export function patch(...args) { return getClient().patch(...args); }
export function del(...args) { return getClient().del(...args); }
export function fetchWithRetry(...args) { return getClient().fetchWithRetry(...args); }
export function apiRequest(...args) { return getClient().apiRequest(...args); }
export function reportClientError(...args) { return getClient().reportClientError(...args); }

export const apiClient = {
  get: (...args) => getClient().apiClient.get(...args),
  post: (...args) => getClient().apiClient.post(...args),
  put: (...args) => getClient().apiClient.put(...args),
  patch: (...args) => getClient().apiClient.patch(...args),
  delete: (...args) => getClient().apiClient.delete(...args),
};

export { getErrorMessage, getErrorCode, isAuthError, isRetryableError, handleApiError };
