/**
 * Tests for cli/lib/auth.js
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('auth', () => {
  let testDir;
  let originalHome;

  beforeEach(() => {
    testDir = join(tmpdir(), `marty-cli-test-${Date.now()}`);
    mkdirSync(join(testDir, '.marty'), { recursive: true });
    // Write empty credentials so each test starts clean
    writeFileSync(join(testDir, '.marty', 'credentials.json'), '{}');
    originalHome = process.env.HOME;
    process.env.HOME = testDir;
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    rmSync(testDir, { recursive: true, force: true });
    vi.resetModules();
  });

  it('should store and retrieve API key credentials', async () => {
    const { loginWithApiKey, whoami, isLoggedIn } = await import('../auth.js');
    loginWithApiKey('test-api-key-1234567890abcdef');
    expect(isLoggedIn()).toBe(true);

    const info = whoami();
    expect(info.type).toBe('api_key');
    expect(info.key).toContain('…');
    expect(info.savedAt).toBeTruthy();
  });

  it('should clear credentials on logout', async () => {
    const { loginWithApiKey, logout, isLoggedIn } = await import('../auth.js');
    loginWithApiKey('test-key');
    expect(isLoggedIn()).toBe(true);
    logout();
    expect(isLoggedIn()).toBe(false);
  });

  it('should return null from whoami when not logged in', async () => {
    const { whoami } = await import('../auth.js');
    expect(whoami()).toBeNull();
  });

  it('should return auth headers for API key', async () => {
    const { loginWithApiKey, getAuthHeaders } = await import('../auth.js');
    loginWithApiKey('my-api-key');
    const headers = getAuthHeaders();
    expect(headers['X-API-Key']).toBe('my-api-key');
  });
});
