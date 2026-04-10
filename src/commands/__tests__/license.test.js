/**
 * Tests for marty license command
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync } from 'node:fs';

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
    expect(subcommands).toContain('status');
    expect(subcommands).toContain('validate');
    expect(subcommands).toContain('deactivate');
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
