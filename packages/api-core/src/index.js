/**
 * API Core — shared HTTP client logic for the Marty Identity Platform.
 *
 * Contains retry, error-parsing, request-ID generation, and the
 * `createApiClient` factory.  Consumed by:
 *   • Browser UI (`marty-ui`) via cookie-based auth
 *   • Node.js CLI (`marty-cli`) via API-key / Bearer auth
 *   • Integration tests
 *
 * No browser-specific APIs (import.meta.env, cookies, DOM) are used here.
 */

const DEFAULT_RETRY_CONFIG = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 10000,
  backoffMultiplier: 2,
  retryableStatuses: [408, 429, 500, 502, 503, 504],
  retryableErrors: ['TypeError', 'NetworkError'],
};

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function calculateDelay(attempt, config) {
  const exponentialDelay = config.baseDelay * Math.pow(config.backoffMultiplier, attempt);
  const cappedDelay = Math.min(exponentialDelay, config.maxDelay);
  const jitter = cappedDelay * 0.25 * (Math.random() * 2 - 1);
  return Math.round(cappedDelay + jitter);
}

function isRetryable(error, response, config) {
  if (error && config.retryableErrors.includes(error.name)) return true;
  if (response && config.retryableStatuses.includes(response.status)) return true;
  if (error?.code === 'ECONNRESET' || error?.code === 'ETIMEDOUT') return true;
  return false;
}

async function parseErrorResponse(response) {
  try {
    const data = await response.json();

    if (data.error) {
      return {
        error: data.error,
        error_description: data.error_description,
        field: data.field,
        details: data.details || data.error?.details,
        request_id: data.request_id || data.message_id,
        message_id: data.message_id,
        timestamp: data.timestamp,
      };
    }

    if (data.errors) {
      return {
        errors: data.errors,
        request_id: data.request_id,
        timestamp: data.timestamp,
      };
    }

    return {
      error: {
        code: `HTTP_${response.status}`,
        message: data.detail || data.message || response.statusText,
        user_message: data.detail || 'An error occurred',
        severity: response.status >= 500 ? 'high' : 'low',
        recovery_action: response.status >= 500 ? 'retry' : 'fail_fast',
      },
      request_id: response.headers.get('X-Request-ID'),
    };
  } catch {
    return {
      error: {
        code: `HTTP_${response.status}`,
        message: response.statusText,
        user_message: 'An unexpected error occurred',
        severity: 'high',
        recovery_action: 'retry',
      },
      request_id: response.headers.get('X-Request-ID'),
    };
  }
}

function generateRequestId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// ── Error helpers (stateless — no config needed) ────────────────────

export function getErrorMessage(error) {
  if (error?.response?.error?.user_message) return error.response.error.user_message;
  if (error?.response?.errors?.[0]?.user_message) return error.response.errors[0].user_message;
  if (error?.message) {
    if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
      return 'Unable to connect to the server. Please check your internet connection.';
    }
    return error.message;
  }
  return 'An unexpected error occurred. Please try again.';
}

export function getErrorCode(error) {
  return error?.response?.error?.code || null;
}

export function isAuthError(error) {
  const code = getErrorCode(error);
  if (code?.startsWith('AUTH.')) return true;
  return error?.status === 401;
}

export function isRetryableError(error) {
  const recoveryAction = error?.response?.error?.recovery_action;
  return recoveryAction === 'retry' || recoveryAction === 'retry_with_backoff';
}

export function handleApiError(error) {
  if (error?.response) return error;
  return new Error(getErrorMessage(error));
}

// ── Factory ─────────────────────────────────────────────────────────

/**
 * Create a configured API client.
 *
 * @param {Object} opts
 * @param {string} opts.baseUrl          - Base URL for all requests (e.g. '' or 'https://api.example.com')
 * @param {() => Object} opts.requestOptions - Returns per-request fetch options (headers, credentials, etc.)
 * @returns {Object} API client with get/post/put/patch/del + helpers
 */
export function createApiClient({ baseUrl = '', requestOptions = () => ({}) } = {}) {

  async function fetchWithRetry(url, options = {}, retryConfig = {}) {
    const method = (options.method || 'GET').toUpperCase();
    const shouldRetry = method === 'GET';
    const config = shouldRetry
      ? { ...DEFAULT_RETRY_CONFIG, ...retryConfig }
      : { maxRetries: 0 };

    let lastError = null;

    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      try {
        const envOpts = requestOptions();
        const headers = {
          'Accept': 'application/json',
          ...envOpts.headers,
          ...options.headers,
        };
        headers['X-Request-ID'] = generateRequestId();
        headers['X-MIP-Version'] = '0.1';

        const mergedOpts = { ...envOpts, ...options, headers };

        const response = await fetch(url, mergedOpts);

        if (response.ok) return response;

        if (shouldRetry && attempt < config.maxRetries && isRetryable(null, response, config)) {
          const delay = calculateDelay(attempt, config);
          console.warn(
            `Request failed with status ${response.status}, retrying in ${delay}ms ` +
            `(attempt ${attempt + 1}/${config.maxRetries})`,
          );
          await sleep(delay);
          continue;
        }

        const errorData = await parseErrorResponse(response);
        const error = new Error(errorData.error?.message || response.statusText);
        error.status = response.status;
        error.response = errorData;
        error.requestId = errorData.request_id;
        throw error;
      } catch (error) {
        lastError = error;
        if (error.response) throw error;
        if (shouldRetry && attempt < config.maxRetries && isRetryable(error, null, config)) {
          const delay = calculateDelay(attempt, config);
          console.warn(
            `Request failed with ${error.name}: ${error.message}, retrying in ${delay}ms ` +
            `(attempt ${attempt + 1}/${config.maxRetries})`,
          );
          await sleep(delay);
          continue;
        }
        throw error;
      }
    }
    throw lastError || new Error('Request failed after retries');
  }

  async function apiRequest(endpoint, options = {}) {
    let url = endpoint.startsWith('http') ? endpoint : `${baseUrl}${endpoint}`;
    if (options.params) {
      const query = new URLSearchParams(options.params).toString();
      if (query) url += `${url.includes('?') ? '&' : '?'}${query}`;
    }
    const { params: _params, ...fetchOptions } = options;
    const response = await fetchWithRetry(url, {
      ...fetchOptions,
      headers: { 'Content-Type': 'application/json', ...fetchOptions.headers },
    });
    const contentType = response.headers.get('Content-Type');
    if (!contentType || !contentType.includes('application/json')) return null;
    return response.json();
  }

  async function get(endpoint, options = {}) {
    return apiRequest(endpoint, { ...options, method: 'GET' });
  }

  async function post(endpoint, data, options = {}) {
    return apiRequest(endpoint, { ...options, method: 'POST', body: JSON.stringify(data) });
  }

  async function put(endpoint, data, options = {}) {
    return apiRequest(endpoint, { ...options, method: 'PUT', body: JSON.stringify(data) });
  }

  async function patch(endpoint, data, options = {}) {
    return apiRequest(endpoint, { ...options, method: 'PATCH', body: JSON.stringify(data) });
  }

  async function del(endpoint, options = {}) {
    return apiRequest(endpoint, { ...options, method: 'DELETE' });
  }

  async function reportClientError(errorReport) {
    try {
      const envOpts = requestOptions();
      const response = await fetch(`${baseUrl}/v1/notifications/client-errors`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-MIP-Version': '0.1',
          ...envOpts.headers,
        },
        ...(envOpts.credentials ? { credentials: envOpts.credentials } : {}),
        body: JSON.stringify(errorReport),
      });
      if (!response.ok) {
        console.warn('Failed to report client error:', response.status);
        return null;
      }
      return response.json();
    } catch (error) {
      console.warn('Failed to report client error:', error.message);
      return null;
    }
  }

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
