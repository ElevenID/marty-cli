/**
 * Tests for cli/lib/config.js
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// We test config functions by overriding the CONFIG_DIR via env.
// Since config.js reads from ~/.marty, we test the public loadConfig
// function which also reads MARTY_* env vars.

describe('config', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('should use MARTY_API_URL env var', async () => {
    process.env.MARTY_API_URL = 'https://custom.example.com';
    const { loadConfig } = await import('../config.js');
    const config = loadConfig();
    expect(config.apiUrl).toBe('https://custom.example.com');
  });

  it('should use MARTY_ORG_ID env var', async () => {
    process.env.MARTY_ORG_ID = 'org-123';
    const { loadConfig } = await import('../config.js');
    const config = loadConfig();
    expect(config.organizationId).toBe('org-123');
  });

  it('should fall back to defaults', async () => {
    delete process.env.MARTY_API_URL;
    delete process.env.MARTY_ORG_ID;
    const { loadConfig } = await import('../config.js');
    const config = loadConfig();
    expect(config.apiUrl).toBe('http://localhost:8000');
    expect(config.organizationId).toBeNull();
  });
});
