/** Public transport contract for the JavaScript factory; no UI framework types. */
export const MIP_VERSION: '0.5.0';

/** Headers are copied from enumerable string-valued object properties. */
export interface MartyFetchOptions extends Omit<RequestInit, 'headers'> {
  headers?: Record<string, string>;
}

/** Values are encoded using URLSearchParams over the object's entries. */
export interface MartyRequestOptions extends MartyFetchOptions {
  params?: Readonly<Record<string, string | number | boolean>>;
}

/** The corresponding helper supplies the method and JSON-encoded body. */
export type MartyJsonOptions = Omit<MartyRequestOptions, 'method' | 'body'>;
export type MartyReadOptions = Omit<MartyRequestOptions, 'method' | 'body'>;
export type MartyDeleteOptions = Omit<MartyRequestOptions, 'method'>;

export interface MartyClientOptions {
  baseUrl?: string;
  /** Synchronous fetch defaults. Query parameters belong to each request. */
  requestOptions?: () => Omit<MartyFetchOptions, 'method' | 'body'>;
}

/** Applies only to GET requests; delays are in milliseconds. */
export interface MartyRetryConfig {
  maxRetries?: number;
  baseDelay?: number;
  maxDelay?: number;
  backoffMultiplier?: number;
  retryableStatuses?: readonly number[];
  retryableErrors?: readonly string[];
}

/** Shape of normalized HTTP failures, not a runtime constructor or type guard. */
export interface MartyHttpError extends Error {
  status: number;
  response: unknown;
  requestId?: string;
}

export function getErrorMessage(error: unknown): string;
export function getErrorCode(error: unknown): string | null;
export function isAuthError(error: unknown): boolean;
export function isRetryableError(error: unknown): boolean;
export function handleApiError<T>(error: T): T | Error;

export interface MartyErrorHelpers {
  getErrorMessage: typeof getErrorMessage;
  getErrorCode: typeof getErrorCode;
  isAuthError: typeof isAuthError;
  isRetryableError: typeof isRetryableError;
  handleApiError: typeof handleApiError;
}

/** Compatibility facade returns only data; it is not an AxiosResponse. */
export interface MartyDataResponse<T = unknown> {
  data: T | null;
}

export interface MartyResponseFacade {
  get<T = unknown>(endpoint: string, options?: MartyReadOptions): Promise<MartyDataResponse<T>>;
  post<T = unknown>(endpoint: string, data: unknown, options?: MartyJsonOptions): Promise<MartyDataResponse<T>>;
  put<T = unknown>(endpoint: string, data: unknown, options?: MartyJsonOptions): Promise<MartyDataResponse<T>>;
  patch<T = unknown>(endpoint: string, data: unknown, options?: MartyJsonOptions): Promise<MartyDataResponse<T>>;
  delete<T = unknown>(endpoint: string, options?: MartyDeleteOptions): Promise<MartyDataResponse<T>>;
}

/**
 * JSON response types default to unknown. T is a caller assertion, not runtime
 * validation. Non-JSON successful responses resolve to null, including 204s.
 * Network and HTTP failures reject; narrow caught values from unknown.
 */
export interface MartyClient extends MartyErrorHelpers {
  fetchWithRetry(url: string, options?: MartyFetchOptions, retryConfig?: MartyRetryConfig): Promise<Response>;
  apiRequest<T = unknown>(endpoint: string, options?: MartyRequestOptions): Promise<T | null>;
  get<T = unknown>(endpoint: string, options?: MartyReadOptions): Promise<T | null>;
  post<T = unknown>(endpoint: string, data: unknown, options?: MartyJsonOptions): Promise<T | null>;
  put<T = unknown>(endpoint: string, data: unknown, options?: MartyJsonOptions): Promise<T | null>;
  patch<T = unknown>(endpoint: string, data: unknown, options?: MartyJsonOptions): Promise<T | null>;
  del<T = unknown>(endpoint: string, options?: MartyDeleteOptions): Promise<T | null>;
  /** Reporting failures are swallowed and resolve to null. */
  reportClientError<T = unknown>(report: unknown): Promise<T | null>;
  apiClient: MartyResponseFacade;
}

export function createApiClient(options?: MartyClientOptions): MartyClient;
