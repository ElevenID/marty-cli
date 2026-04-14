/**
 * Tests for marty license command
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'node:fs';
import { generateKeyPairSync, sign } from 'node:crypto';
import { join } from 'node:path';

// Mock fs operations
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => ''),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
});

// Mock config
vi.mock('../../lib/config.js', () => ({
  getConfigDir: vi.fn(() => '/tmp/test-marty'),
}));

// Mock apiAdapter
vi.mock('../../lib/apiAdapter.js', () => ({
  get: vi.fn(),
}));

// Sample JWT: header.payload.signature (payload is base64url-encoded JSON)
function makeTestJwt(claims = {}) {
  const defaultClaims = {
    iss: 'marty-license-issuer',
    sub: 'org-test-123',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 86400 * 365,
    jti: 'lic_test1234567890',
    org_name: 'Test Organization',
    plan_tier: 'institution',
    entitled_products: ['verifier', 'document-signer'],
    features: ['mdl', 'emrtd'],
    registry_access: true,
    api_calls_limit: 500000,
    deployment_mode: 'production',
    ...claims,
  };
  const header = Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(defaultClaims)).toString('base64url');
  return `${header}.${payload}.fakesig`;
}

function makeSignedSelfHostLicense(claims = {}) {
  const defaultClaims = {
    iss: 'marty-license-issuer',
    sub: 'org-selfhost-123',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 86400 * 365,
    jti: 'lic_selfhost1234567890',
    org_name: 'Self Host Organization',
    plan_tier: 'system',
    entitled_products: ['ui-app'],
    features: ['self-host'],
    deployment_mode: 'production',
    ...claims,
  };

  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const header = Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(defaultClaims)).toString('base64url');
  const signingInput = `${header}.${payload}`;
  const signature = sign(null, Buffer.from(signingInput, 'ascii'), privateKey).toString('base64url');
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();

  return {
    jwt: `${signingInput}.${signature}`,
    publicPem,
  };
}

describe('license command', () => {
  let logSpy, errSpy, exitSpy;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('registers license command with subcommands', async () => {
    const { registerLicenseCommands } = await import('../../commands/license.js');

    const subcommands = [];
    const fakeSubcmd = {
      command: vi.fn(function (name) { subcommands.push(name.split(' ')[0]); return this; }),
      description: vi.fn(function () { return this; }),
      option: vi.fn(function () { return this; }),
      action: vi.fn(function () { return this; }),
    };

    const fakeCmd = {
      command: vi.fn(() => ({
        ...fakeSubcmd,
        description: vi.fn().mockReturnValue({
          ...fakeSubcmd,
          command: vi.fn((n) => { subcommands.push(n.split(' ')[0]); return fakeSubcmd; }),
        }),
      })),
    };

    registerLicenseCommands(fakeCmd);
    expect(subcommands).toContain('activate');
    expect(subcommands).toContain('install-selfhost');
    expect(subcommands).toContain('status');
    expect(subcommands).toContain('validate');
    expect(subcommands).toContain('deactivate');
  });

  it('install-selfhost validates and writes the secret files', async () => {
    const fs = await import('node:fs');
    const { jwt, publicPem } = makeSignedSelfHostLicense();

    fs.existsSync.mockImplementation((path) => path === '.env.selfhost.production.local');
    fs.readFileSync.mockImplementation((path) => {
      if (path === '.env.selfhost.production.local') {
        return [
          'SELFHOST_SECRET_DIR=/tmp/selfhost-secrets',
          'MARTY_LICENSE_REQUIRED_ISSUER=marty-license-issuer',
          'MARTY_LICENSE_REQUIRED_PLAN_TIER=system',
          'MARTY_LICENSE_REQUIRED_PRODUCTS=ui-app',
        ].join('\n');
      }
      if (path === '/tmp/license.jwt') {
        return jwt;
      }
      if (path === '/tmp/license-public-key.pem') {
        return publicPem;
      }
      return '';
    });

    const { Command } = await import('commander');
    const { registerLicenseCommands } = await import('../../commands/license.js');

    const program = new Command();
    program.exitOverride();
    registerLicenseCommands(program);

    await program.parseAsync([
      'node',
      'marty',
      'license',
      'install-selfhost',
      '--env-file',
      '.env.selfhost.production.local',
      '--token-file',
      '/tmp/license.jwt',
      '--public-key-file',
      '/tmp/license-public-key.pem',
    ]);

    expect(fs.mkdirSync).toHaveBeenCalledWith('/tmp/selfhost-secrets', { recursive: true, mode: 0o700 });
    expect(fs.writeFileSync).toHaveBeenCalledWith(join('/tmp/selfhost-secrets', 'license_key'), `${jwt}\n`, { mode: 0o600 });
    expect(fs.writeFileSync).toHaveBeenCalledWith(join('/tmp/selfhost-secrets', 'license_public_key'), `${publicPem.trim()}\n`, { mode: 0o600 });
    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('Self-host license installed.');
    expect(output).toContain('Self Host Organization');
    expect(output).not.toContain(jwt);
  });

  it('install-selfhost rejects a license that misses the required product', async () => {
    const fs = await import('node:fs');
    const { jwt, publicPem } = makeSignedSelfHostLicense({ entitled_products: ['verifier'] });

    fs.existsSync.mockImplementation((path) => path === '.env.selfhost.production.local');
    fs.readFileSync.mockImplementation((path) => {
      if (path === '.env.selfhost.production.local') {
        return [
          'SELFHOST_SECRET_DIR=/tmp/selfhost-secrets',
          'MARTY_LICENSE_REQUIRED_ISSUER=marty-license-issuer',
          'MARTY_LICENSE_REQUIRED_PLAN_TIER=system',
          'MARTY_LICENSE_REQUIRED_PRODUCTS=ui-app',
        ].join('\n');
      }
      if (path === '/tmp/license.jwt') {
        return jwt;
      }
      if (path === '/tmp/license-public-key.pem') {
        return publicPem;
      }
      return '';
    });

    const { Command } = await import('commander');
    const { registerLicenseCommands } = await import('../../commands/license.js');

    const program = new Command();
    program.exitOverride();
    registerLicenseCommands(program);

    await program.parseAsync([
      'node',
      'marty',
      'license',
      'install-selfhost',
      '--env-file',
      '.env.selfhost.production.local',
      '--token-file',
      '/tmp/license.jwt',
      '--public-key-file',
      '/tmp/license-public-key.pem',
    ]);

    const errOutput = errSpy.mock.calls.map(c => c[0]).join('\n');
    expect(errOutput).toContain('missing required entitled products');
  });

  it('activate stores the license JWT', async () => {
    const { writeFileSync } = await import('node:fs');
    const { Command } = await import('commander');
    const { registerLicenseCommands } = await import('../../commands/license.js');

    const program = new Command();
    program.exitOverride();
    registerLicenseCommands(program);

    const jwt = makeTestJwt();
    await program.parseAsync(['node', 'marty', 'license', 'activate', jwt]);

    expect(writeFileSync).toHaveBeenCalled();
    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('License activated');
    expect(output).toContain('Test Organization');
    expect(output).toContain('institution');
  });

  it('activate rejects non-JWT input', async () => {
    const { Command } = await import('commander');
    const { registerLicenseCommands } = await import('../../commands/license.js');

    const program = new Command();
    program.exitOverride();
    registerLicenseCommands(program);

    await program.parseAsync(['node', 'marty', 'license', 'activate', 'not-a-jwt']);

    expect(errSpy).toHaveBeenCalled();
    const errOutput = errSpy.mock.calls.map(c => c[0]).join('\n');
    expect(errOutput).toContain('Invalid license token');
  });

  it('status shows license info when activated', async () => {
    const fs = await import('node:fs');
    const jwt = makeTestJwt();
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(jwt);

    const { Command } = await import('commander');
    const { registerLicenseCommands } = await import('../../commands/license.js');

    const program = new Command();
    program.exitOverride();
    registerLicenseCommands(program);

    await program.parseAsync(['node', 'marty', 'license', 'status']);

    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('institution');
    expect(output).toContain('Test Organization');
  });

  it('status --output json prints JSON', async () => {
    const fs = await import('node:fs');
    const jwt = makeTestJwt();
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(jwt);

    const { Command } = await import('commander');
    const { registerLicenseCommands } = await import('../../commands/license.js');

    const program = new Command();
    program.exitOverride();
    registerLicenseCommands(program);

    await program.parseAsync(['node', 'marty', 'license', 'status', '--output', 'json']);

    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    const parsed = JSON.parse(output);
    expect(parsed.plan_tier).toBe('institution');
    expect(parsed.license_id).toBe('lic_test1234567890');
  });

  it('status fails when no license activated', async () => {
    const fs = await import('node:fs');
    fs.existsSync.mockReturnValue(false);

    const { Command } = await import('commander');
    const { registerLicenseCommands } = await import('../../commands/license.js');

    const program = new Command();
    program.exitOverride();
    registerLicenseCommands(program);

    await program.parseAsync(['node', 'marty', 'license', 'status']);

    expect(errSpy).toHaveBeenCalled();
    const errOutput = errSpy.mock.calls.map(c => c[0]).join('\n');
    expect(errOutput).toContain('No license activated');
  });

  it('validate calls the API with the JTI', async () => {
    const fs = await import('node:fs');
    const jwt = makeTestJwt({ jti: 'lic_abc123' });
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(jwt);

    const { get } = await import('../../lib/apiAdapter.js');
    get.mockResolvedValue({ status: 'active', valid: true });

    const { Command } = await import('commander');
    const { registerLicenseCommands } = await import('../../commands/license.js');

    const program = new Command();
    program.exitOverride();
    registerLicenseCommands(program);

    await program.parseAsync(['node', 'marty', 'license', 'validate']);

    expect(get).toHaveBeenCalledWith('/v1/licenses/validate/lic_abc123');
    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('active');
  });

  it('deactivate removes the license file', async () => {
    const fs = await import('node:fs');
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(makeTestJwt());

    const { Command } = await import('commander');
    const { registerLicenseCommands } = await import('../../commands/license.js');

    const program = new Command();
    program.exitOverride();
    registerLicenseCommands(program);

    await program.parseAsync(['node', 'marty', 'license', 'deactivate']);

    expect(fs.unlinkSync).toHaveBeenCalled();
    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('deactivated');
  });

  it('deactivate when no license says none activated', async () => {
    const fs = await import('node:fs');
    fs.existsSync.mockReturnValue(false);

    const { Command } = await import('commander');
    const { registerLicenseCommands } = await import('../../commands/license.js');

    const program = new Command();
    program.exitOverride();
    registerLicenseCommands(program);

    await program.parseAsync(['node', 'marty', 'license', 'deactivate']);

    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('No license');
  });

  it('status shows unlimited for api_calls_limit=0', async () => {
    const fs = await import('node:fs');
    const jwt = makeTestJwt({ api_calls_limit: 0 });
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(jwt);

    const { Command } = await import('commander');
    const { registerLicenseCommands } = await import('../../commands/license.js');

    const program = new Command();
    program.exitOverride();
    registerLicenseCommands(program);

    await program.parseAsync(['node', 'marty', 'license', 'status']);

    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('unlimited');
  });
});
