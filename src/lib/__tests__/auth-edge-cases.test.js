/**
 * Tests exposing auth.js edge cases.
 *
 * Issue 2.1: whoami() returns null for session auth (isLoggedIn() is true but whoami() says "Not logged in")
 * Issue 2.2: loginWithClientCredentials() accepts 200 with missing access_token
 * Issue 2.3: API key masking reveals full key for short keys (≤12 chars)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// We mock config.js to control credentials directly without filesystem issues.
let mockCredentials = {};
let savedCredentials = null;

vi.mock('../config.js', () => ({
  loadConfig: vi.fn(() => ({
    apiUrl: 'http://localhost:8000',
    organizationId: 'org-1',
  })),
  loadCredentials: vi.fn(() => mockCredentials),
  saveCredentials: vi.fn((creds) => { savedCredentials = creds; }),
  clearCredentials: vi.fn(() => { mockCredentials = {}; }),
}));

describe('auth edge cases', () => {
  beforeEach(() => {
    mockCredentials = {};
    savedCredentials = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Issue 2.1: whoami returns null for session auth ────────────────

  describe('session auth whoami inconsistency', () => {
    it('BUG: isLoggedIn() returns true for session credentials', async () => {
      mockCredentials = { type: 'session', sessionId: 'sess-abc123' };

      const { isLoggedIn } = await import('../auth.js');
      expect(isLoggedIn()).toBe(true);
    });

    it('BUG: whoami() returns null for session auth despite isLoggedIn()=true', async () => {
      mockCredentials = { type: 'session', sessionId: 'sess-abc123' };

      const { whoami, isLoggedIn } = await import('../auth.js');

      // isLoggedIn says true…
      expect(isLoggedIn()).toBe(true);

      // …but whoami falls through the api_key and oauth2 if-branches and returns null
      // (there's no handler for type==='session')
      const info = whoami();
      expect(info).toBeNull(); // This IS the bug — should return session info
    });

    it('BUG: getAuthHeaders() works for session but whoami() does not', async () => {
      mockCredentials = { type: 'session', sessionId: 'sess-xyz' };

      const { getAuthHeaders, whoami } = await import('../auth.js');

      // Headers work
      const headers = getAuthHeaders();
      expect(headers).toHaveProperty('Cookie', 'sessionId=sess-xyz');

      // whoami does NOT — returns null for session type
      expect(whoami()).toBeNull();
    });
  });

  // ── Issue 2.2: missing access_token silently saved ────────────────

  describe('loginWithClientCredentials missing access_token', () => {
    it('BUG: saves undefined accessToken when response has no access_token field', async () => {
      // Mock fetch to return a 200 with an error body (Keycloak sometimes does this)
      const originalFetch = globalThis.fetch;
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ error: 'invalid_client' }),
        text: () => Promise.resolve(''),
        statusText: 'OK',
      });

      try {
        const { loginWithClientCredentials } = await import('../auth.js');

        await loginWithClientCredentials({
          clientId: 'bad-client',
          clientSecret: 'bad-secret',
          tokenUrl: 'http://keycloak/token',
        });

        // saveCredentials was called with the response data
        expect(savedCredentials).not.toBeNull();
        expect(savedCredentials.type).toBe('oauth2');
        // The bug: data.access_token is undefined, but we saved anyway
        expect(savedCredentials.accessToken).toBeUndefined();

        // Now set mockCredentials to what was saved and check isLoggedIn
        mockCredentials = savedCredentials;
        const { isLoggedIn } = await import('../auth.js');

        // isLoggedIn returns false because accessToken is undefined/falsy —
        // but credentials file was modified, creating an inconsistent state
        expect(isLoggedIn()).toBe(false);
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  // ── Issue 2.3: short API key masking ──────────────────────────────

  describe('API key masking for short keys', () => {
    it('BUG: masking reveals full key for keys shorter than 12 characters', async () => {
      const shortKey = 'abc12345'; // 8 chars
      mockCredentials = { type: 'api_key', apiKey: shortKey, savedAt: new Date().toISOString() };

      const { whoami } = await import('../auth.js');
      const info = whoami();

      // slice(0,8) = "abc12345", slice(-4) = "2345"
      // result: "abc12345…2345" — the full key is reconstructable
      expect(info.key).toContain('…');

      // Extract the visible parts
      const [prefix, suffix] = info.key.split('…');

      // BUG: prefix + suffix covers the entire key
      expect(prefix.length + suffix.length).toBeGreaterThanOrEqual(shortKey.length);
    });

    it('BUG: 4-char key is fully visible in both halves', async () => {
      mockCredentials = { type: 'api_key', apiKey: 'abcd', savedAt: new Date().toISOString() };

      const { whoami } = await import('../auth.js');
      const info = whoami();

      const [prefix, suffix] = info.key.split('…');

      // prefix = 'abcd' (slice(0,8) on a 4-char key returns full key)
      // suffix = 'abcd' (slice(-4) on a 4-char key returns full key)
      expect(prefix).toBe('abcd');
      expect(suffix).toBe('abcd');
    });

    it('long key masking hides middle portion', async () => {
      const longKey = 'sk_live_1234567890abcdefghijklmnop'; // 32 chars
      mockCredentials = { type: 'api_key', apiKey: longKey, savedAt: new Date().toISOString() };

      const { whoami } = await import('../auth.js');
      const info = whoami();

      const [prefix, suffix] = info.key.split('…');
      // prefix=8, suffix=4, total=12 — hides the other 20 chars
      expect(prefix.length + suffix.length).toBeLessThan(longKey.length);
    });
  });
});
