import {
  MIP_VERSION, createApiClient, getErrorCode, getErrorMessage, handleApiError,
  isAuthError, isRetryableError,
} from '@elevenid/marty-api-core';
import type {
  MartyClient, MartyClientOptions, MartyDataResponse, MartyDeleteOptions,
  MartyFetchOptions, MartyHttpError, MartyJsonOptions, MartyReadOptions,
  MartyRequestOptions, MartyResponseFacade, MartyRetryConfig,
} from '@elevenid/marty-api-core';

type IsAny<T> = 0 extends (1 & T) ? true : false;
type AssertFalse<T extends false> = T;
type DefaultPayloadIsUnknown = AssertFalse<IsAny<Awaited<ReturnType<MartyClient['get']>>>>;
type FacadeDataIsUnknown = AssertFalse<IsAny<Awaited<ReturnType<MartyResponseFacade['get']>>['data']>>;

const protocol: '0.5.0' = MIP_VERSION;
const defaults: MartyClientOptions = {
  baseUrl: 'https://example.invalid',
  requestOptions: () => ({ headers: { 'X-API-Key': 'mk_test_type_fixture' }, credentials: 'omit' }),
};
const client: MartyClient = createApiClient(defaults);
createApiClient();
const options: MartyRequestOptions = {
  headers: { 'X-Organization-ID': 'org-fixture' },
  params: { limit: 0, offset: 4, active: false, name: 'Fixture' },
  credentials: 'include', signal: new AbortController().signal,
};
const read: MartyReadOptions = options;
const json: MartyJsonOptions = { headers: { 'Content-Type': 'application/json' } };
const deletion: MartyDeleteOptions = { body: '{"reason":"fixture"}' };
const retry: MartyRetryConfig = {
  maxRetries: 0, baseDelay: 1, maxDelay: 10, backoffMultiplier: 2,
  retryableStatuses: [429, 503] as const, retryableErrors: ['NetworkError'] as const,
};
const fetchOptions: MartyFetchOptions = { method: 'GET', headers: { Accept: 'application/json' } };
const response: Response = await client.fetchWithRetry('https://example.invalid', fetchOptions, retry);
const text: string = await response.text();

interface Fixture { id: string }
const direct: Fixture | null = await client.get<Fixture>('/fixture', read);
const raw: unknown = await client.apiRequest('/fixture', { ...options, method: 'GET' });
const post: Fixture | null = await client.post<Fixture>('/fixture', { id: 'fixture' }, json);
const put: Fixture | null = await client.put<Fixture>('/fixture', { id: 'fixture' }, json);
const patch: Fixture | null = await client.patch<Fixture>('/fixture', { id: 'fixture' }, json);
const removed: Fixture | null = await client.del<Fixture>('/fixture', deletion);
const report: unknown = await client.reportClientError({ message: 'fixture' });
const wrapped: MartyDataResponse<Fixture> = await client.apiClient.get<Fixture>('/fixture', read);
await client.apiClient.post('/fixture', { id: 'fixture' }, json);
await client.apiClient.put('/fixture', { id: 'fixture' }, json);
await client.apiClient.patch('/fixture', { id: 'fixture' }, json);
await client.apiClient.delete('/fixture', deletion);
if (direct !== null) { const id: string = direct.id; void id; }
if (wrapped.data !== null) { const id: string = wrapped.data.id; void id; }
function describeFailure(error: unknown): string {
  const code: string | null = getErrorCode(error);
  const auth: boolean = isAuthError(error);
  const retryable: boolean = isRetryableError(error);
  const message: string = getErrorMessage(error);
  const handled: unknown = handleApiError(error);
  client.getErrorCode(error); client.getErrorMessage(error);
  client.isAuthError(error); client.isRetryableError(error); client.handleApiError(error);
  void [auth, retryable, handled];
  return code ?? message;
}
function normalizedShape(error: MartyHttpError): number { return error.status; }

// No request runs: this fixture is compiled with noEmit in isolated projects.
// @ts-expect-error Unknown JSON is not an implicitly trusted application DTO.
const trusted: Fixture = await client.get('/fixture');
// @ts-expect-error Non-JSON successes return null even when T is supplied.
const nonnullable: Fixture = await client.get<Fixture>('/fixture');
// @ts-expect-error The compatibility facade has data only, not Axios status.
wrapped.status;
// @ts-expect-error Headers instances are not copied by the Rust object-entry adapter.
client.get('/fixture', { headers: new Headers() });
// @ts-expect-error Header tuples are not supported by the object-entry adapter.
client.get('/fixture', { headers: [['X-API-Key', 'fixture']] });
// @ts-expect-error Header values must be strings.
client.get('/fixture', { headers: { 'X-API-Key': undefined } });
// @ts-expect-error The default callback is synchronous.
createApiClient({ requestOptions: async () => ({ credentials: 'include' }) });
// @ts-expect-error Query parameters are a plain scalar-valued object.
client.get('/fixture', { params: new URLSearchParams() });
// @ts-expect-error Nested query objects have no portable wire contract.
client.get('/fixture', { params: { nested: { id: 'fixture' } } });
// @ts-expect-error JSON helpers supply the method and body.
client.post('/fixture', {}, { method: 'PATCH' });
// @ts-expect-error JSON helpers encode the data argument themselves.
client.post('/fixture', {}, { body: 'override' });
// @ts-expect-error GET helpers do not accept request bodies.
client.get('/fixture', { body: 'override' });
// @ts-expect-error Raw fetch has no API query parameter expansion.
client.fetchWithRetry('https://example.invalid', { params: { q: 'fixture' } });
// @ts-expect-error Retry counts are numeric.
client.fetchWithRetry('https://example.invalid', {}, { maxRetries: '3' });
// @ts-expect-error The public direct helper is named del.
client.delete('/fixture');
// @ts-expect-error Error codes can be absent.
const requiredCode: string = getErrorCode(new Error());
// @ts-expect-error The public result interface is not a runtime constructor.
new MartyClient();
// @ts-expect-error Generated WASM bindings are not a public package subpath.
await import('@elevenid/marty-api-core/src/wasm/marty_api_client.js');
void [protocol, text, raw, post, put, patch, removed, report, describeFailure, normalizedShape];
