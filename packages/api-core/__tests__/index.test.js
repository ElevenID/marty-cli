/**
 * Tests for @elevenid/marty-api-core — the shared API client factory.
 *
 * Verifies the factory, error helpers, and request building
 * without hitting a real network (uses vi.fn mocks for fetch).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createApiClient,
  getErrorMessage,
  getErrorCode,
  isAuthError,
  isRetryableError,
  handleApiError,
} from '../src/index.js';

describe('apiCore', () => {
  describe('error helpers', () => {
    it('getErrorMessage should extract user_message', () => {
      const err = { response: { error: { user_message: 'Bad input' } } };
      expect(getErrorMessage(err)).toBe('Bad input');
    });

    it('getErrorMessage should handle network errors', () => {
      const err = { message: 'Failed to fetch' };
      expect(getErrorMessage(err)).toContain('Unable to connect');
    });

    it('getErrorMessage should return fallback for empty error', () => {
      expect(getErrorMessage(null)).toContain('unexpected error');
    });

    it('getErrorCode should extract code', () => {
      const err = { response: { error: { code: 'AUTH.EXPIRED' } } };
      expect(getErrorCode(err)).toBe('AUTH.EXPIRED');
    });

    it('getErrorCode should return null for missing code', () => {
      expect(getErrorCode({})).toBeNull();
    });

    it('isAuthError should detect AUTH codes', () => {
      const err = { response: { error: { code: 'AUTH.TOKEN_EXPIRED' } } };
      expect(isAuthError(err)).toBe(true);
    });

    it('isAuthError should detect 401 status', () => {
      expect(isAuthError({ status: 401 })).toBe(true);
    });

    it('isAuthError should return false for other errors', () => {
      expect(isAuthError({ status: 403 })).toBe(false);
    });

    it('isRetryableError should detect retry recovery action', () => {
      const err = { response: { error: { recovery_action: 'retry' } } };
      expect(isRetryableError(err)).toBe(true);
    });

    it('handleApiError should pass through errors with response', () => {
      const err = { response: { error: { code: 'TEST' } } };
      expect(handleApiError(err)).toBe(err);
    });

    it('handleApiError should wrap plain errors', () => {
      const result = handleApiError({ message: 'oops' });
      expect(result).toBeInstanceOf(Error);
      expect(result.message).toBe('oops');
    });
  });

  describe('createApiClient', () => {
    let originalFetch;

    beforeEach(() => {
      originalFetch = globalThis.fetch;
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it('should create a client with all expected methods', () => {
      const client = createApiClient({ baseUrl: 'http://test.example' });
      expect(typeof client.get).toBe('function');
      expect(typeof client.post).toBe('function');
      expect(typeof client.put).toBe('function');
      expect(typeof client.patch).toBe('function');
      expect(typeof client.del).toBe('function');
      expect(typeof client.fetchWithRetry).toBe('function');
      expect(typeof client.apiRequest).toBe('function');
      expect(typeof client.apiClient.get).toBe('function');
      expect(typeof client.apiClient.delete).toBe('function');
    });

    it('should prepend baseUrl to relative endpoints', async () => {
      let capturedUrl;
      globalThis.fetch = vi.fn(async (url) => {
        capturedUrl = url;
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      const client = createApiClient({ baseUrl: 'https://api.test.com' });
      await client.get('/v1/health');
      expect(capturedUrl).toBe('https://api.test.com/v1/health');
    });

    it('should not prepend baseUrl to absolute URLs', async () => {
      let capturedUrl;
      globalThis.fetch = vi.fn(async (url) => {
        capturedUrl = url;
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      const client = createApiClient({ baseUrl: 'https://api.test.com' });
      await client.get('https://other.example.com/path');
      expect(capturedUrl).toBe('https://other.example.com/path');
    });

    it('should include requestOptions headers', async () => {
      let capturedOpts;
      globalThis.fetch = vi.fn(async (url, opts) => {
        capturedOpts = opts;
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      const client = createApiClient({
        baseUrl: 'http://test',
        requestOptions: () => ({
          headers: { 'Authorization': 'Bearer tok123' },
        }),
      });
      await client.get('/v1/test');
      expect(capturedOpts.headers['Authorization']).toBe('Bearer tok123');
      expect(capturedOpts.headers['X-Request-ID']).toBeTruthy();
      expect(capturedOpts.headers['X-MIP-Version']).toBe('0.1');
    });

    it('should include credentials from requestOptions', async () => {
      let capturedOpts;
      globalThis.fetch = vi.fn(async (url, opts) => {
        capturedOpts = opts;
        return new Response(JSON.stringify({}), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      const client = createApiClient({
        baseUrl: 'http://test',
        requestOptions: () => ({ credentials: 'include' }),
      });
      await client.get('/v1/test');
      expect(capturedOpts.credentials).toBe('include');
    });

    it('should send JSON body on POST', async () => {
      let capturedBody;
      globalThis.fetch = vi.fn(async (url, opts) => {
        capturedBody = opts.body;
        return new Response(JSON.stringify({ id: 1 }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      const client = createApiClient({ baseUrl: 'http://test' });
      await client.post('/v1/items', { name: 'Test' });
      expect(JSON.parse(capturedBody)).toEqual({ name: 'Test' });
    });

    it('should throw on non-OK response with parsed error', async () => {
      globalThis.fetch = vi.fn(async () => {
        return new Response(JSON.stringify({
          error: { code: 'NOT_FOUND', message: 'Item not found', user_message: 'Not found' },
        }), {
          status: 404,
          statusText: 'Not Found',
          headers: { 'Content-Type': 'application/json' },
        });
      });

      const client = createApiClient({ baseUrl: 'http://test' });
      try {
        await client.get('/v1/items/999');
        expect.unreachable();
      } catch (err) {
        expect(err.status).toBe(404);
        expect(err.response.error.code).toBe('NOT_FOUND');
      }
    });

    it('apiClient should wrap result in { data }', async () => {
      globalThis.fetch = vi.fn(async () => {
        return new Response(JSON.stringify({ items: [1, 2, 3] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      const client = createApiClient({ baseUrl: 'http://test' });
      const result = await client.apiClient.get('/v1/items');
      expect(result.data).toEqual({ items: [1, 2, 3] });
    });
  });
});
