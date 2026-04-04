/**
 * Tests for cli/commands/credentials.js
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../lib/apiAdapter.js', () => ({
  get: vi.fn(),
  post: vi.fn(),
}));

vi.mock('../../lib/config.js', () => ({
  loadConfig: vi.fn(() => ({
    apiUrl: 'http://localhost:8000',
    organizationId: 'org-1',
  })),
}));

describe('credentials command', () => {
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

  it('registers credentials command with list, inspect, revoke', async () => {
    const { registerCredentialsCommands } = await import('../../commands/credentials.js');

    const commands = [];
    const subcommands = [];

    const fakeSubcmd = {
      command: vi.fn(function (name) { subcommands.push(name.split(' ')[0]); return this; }),
      alias: vi.fn(function () { return this; }),
      description: vi.fn(function () { return this; }),
      option: vi.fn(function () { return this; }),
      requiredOption: vi.fn(function () { return this; }),
      action: vi.fn(function () { return this; }),
    };

    const fakeCmd = {
      command: vi.fn((name) => {
        commands.push(name);
        return { ...fakeSubcmd, command: vi.fn((n) => { subcommands.push(n.split(' ')[0]); return fakeSubcmd; }) };
      }),
    };

    registerCredentialsCommands(fakeCmd);
    expect(commands).toContain('credentials');
    expect(subcommands).toContain('list');
    expect(subcommands).toContain('inspect');
    expect(subcommands).toContain('revoke');
  });

  it('credentials list outputs JSON', async () => {
    const { get } = await import('../../lib/apiAdapter.js');
    const { Command } = await import('commander');
    const { registerCredentialsCommands } = await import('../../commands/credentials.js');

    get.mockResolvedValue({
      credentials: [
        { id: 'cred-1', credential_type: 'DriverLicense', status: 'active', issued_at: '2026-01-01T00:00:00Z', holder_identifier: 'did:example:alice' },
        { id: 'cred-2', credential_type: 'Passport', status: 'revoked', issued_at: '2026-02-01T00:00:00Z', holder_identifier: 'did:example:bob' },
      ],
    });

    const program = new Command();
    program.exitOverride();
    registerCredentialsCommands(program);

    await program.parseAsync(['node', 'marty', 'credentials', 'list', '-o', 'json']);
    const output = logSpy.mock.calls.map(c => c[0]).join('');
    const parsed = JSON.parse(output);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].id).toBe('cred-1');
  });

  it('credentials list passes organization_id and limit', async () => {
    const { get } = await import('../../lib/apiAdapter.js');
    const { Command } = await import('commander');
    const { registerCredentialsCommands } = await import('../../commands/credentials.js');

    get.mockResolvedValue([]);

    const program = new Command();
    program.exitOverride();
    registerCredentialsCommands(program);

    await program.parseAsync(['node', 'marty', 'credentials', 'list', '--limit', '10', '-o', 'json']);

    expect(get).toHaveBeenCalled();
    const url = get.mock.calls[0][0];
    expect(url).toContain('limit=10');
    expect(url).toContain('organization_id=org-1');
  });

  it('credentials inspect fetches by ID', async () => {
    const { get } = await import('../../lib/apiAdapter.js');
    const { Command } = await import('commander');
    const { registerCredentialsCommands } = await import('../../commands/credentials.js');

    get.mockResolvedValue({ id: 'cred-42', status: 'active' });

    const program = new Command();
    program.exitOverride();
    registerCredentialsCommands(program);

    await program.parseAsync(['node', 'marty', 'credentials', 'inspect', 'cred-42']);

    expect(get).toHaveBeenCalledWith('/v1/credentials/cred-42');
    const output = logSpy.mock.calls.map(c => c[0]).join('');
    const parsed = JSON.parse(output);
    expect(parsed.id).toBe('cred-42');
  });

  it('credentials revoke --dry-run does not call API', async () => {
    const { post } = await import('../../lib/apiAdapter.js');
    const { Command } = await import('commander');
    const { registerCredentialsCommands } = await import('../../commands/credentials.js');

    const program = new Command();
    program.exitOverride();
    registerCredentialsCommands(program);

    await program.parseAsync(['node', 'marty', 'credentials', 'revoke', 'cred-99', '--dry-run']);

    expect(post).not.toHaveBeenCalled();
    const output = logSpy.mock.calls.map(c => c[0]).join(' ');
    expect(output).toContain('dry-run');
  });

  it('credentials revoke sends reason and immediate', async () => {
    const { post } = await import('../../lib/apiAdapter.js');
    const { Command } = await import('commander');
    const { registerCredentialsCommands } = await import('../../commands/credentials.js');

    post.mockResolvedValue({ ok: true });

    const program = new Command();
    program.exitOverride();
    registerCredentialsCommands(program);

    await program.parseAsync([
      'node', 'marty', 'credentials', 'revoke', 'cred-99',
      '--reason', 'compromised', '--immediate',
    ]);

    expect(post).toHaveBeenCalledWith('/v1/credentials/revoke', {
      credential_id: 'cred-99',
      reason: 'compromised',
      immediate: true,
    });
  });
});
