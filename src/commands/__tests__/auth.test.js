/**
 * Tests for cli/commands/auth.js
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../lib/auth.js', () => ({
  loginWithApiKey: vi.fn(),
  loginWithClientCredentials: vi.fn(),
  logout: vi.fn(),
  whoami: vi.fn(),
}));

vi.mock('../../lib/prompt.js', () => ({
  ask: vi.fn(),
  select: vi.fn(),
  isInteractive: vi.fn(() => false),
}));

describe('auth command', () => {
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

  it('registers auth command with login, logout, whoami', async () => {
    const { registerAuthCommands } = await import('../../commands/auth.js');

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

    registerAuthCommands(fakeCmd);
    expect(subcommands).toContain('login');
    expect(subcommands).toContain('logout');
    expect(subcommands).toContain('whoami');
  });

  it('auth login --api-key calls loginWithApiKey', async () => {
    const { loginWithApiKey } = await import('../../lib/auth.js');
    const { Command } = await import('commander');
    const { registerAuthCommands } = await import('../../commands/auth.js');

    const program = new Command();
    program.exitOverride();
    registerAuthCommands(program);

    await program.parseAsync(['node', 'marty', 'auth', 'login', '--api-key', 'my-key-123']);

    expect(loginWithApiKey).toHaveBeenCalledWith('my-key-123');
    const output = logSpy.mock.calls.map(c => c[0]).join(' ');
    expect(output).toContain('Logged in');
  });

  it('auth login --client-id --client-secret calls loginWithClientCredentials', async () => {
    const { loginWithClientCredentials } = await import('../../lib/auth.js');
    const { Command } = await import('commander');
    const { registerAuthCommands } = await import('../../commands/auth.js');

    loginWithClientCredentials.mockResolvedValue();

    const program = new Command();
    program.exitOverride();
    registerAuthCommands(program);

    await program.parseAsync([
      'node', 'marty', 'auth', 'login',
      '--client-id', 'my-client',
      '--client-secret', 'my-secret',
      '--token-url', 'https://auth.example.com/token',
    ]);

    expect(loginWithClientCredentials).toHaveBeenCalledWith({
      clientId: 'my-client',
      clientSecret: 'my-secret',
      tokenUrl: 'https://auth.example.com/token',
    });
  });

  it('auth login in non-interactive mode without credentials exits', async () => {
    const { Command } = await import('commander');
    const { registerAuthCommands } = await import('../../commands/auth.js');

    const program = new Command();
    program.exitOverride();
    registerAuthCommands(program);

    await program.parseAsync(['node', 'marty', 'auth', 'login']);

    // Should exit with code 2 for missing credentials in non-interactive mode
    expect(exitSpy).toHaveBeenCalledWith(2);
  });

  it('auth logout calls logout and prints message', async () => {
    const { logout } = await import('../../lib/auth.js');
    const { Command } = await import('commander');
    const { registerAuthCommands } = await import('../../commands/auth.js');

    const program = new Command();
    program.exitOverride();
    registerAuthCommands(program);

    await program.parseAsync(['node', 'marty', 'auth', 'logout']);

    expect(logout).toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith('Logged out.');
  });

  it('auth whoami shows auth info', async () => {
    const { whoami } = await import('../../lib/auth.js');
    const { Command } = await import('commander');
    const { registerAuthCommands } = await import('../../commands/auth.js');

    whoami.mockReturnValue({ type: 'api_key', key: '…abc', savedAt: '2026-01-01T00:00:00Z' });

    const program = new Command();
    program.exitOverride();
    registerAuthCommands(program);

    await program.parseAsync(['node', 'marty', 'auth', 'whoami']);

    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('api_key');
  });

  it('auth whoami shows not-logged-in message', async () => {
    const { whoami } = await import('../../lib/auth.js');
    const { Command } = await import('commander');
    const { registerAuthCommands } = await import('../../commands/auth.js');

    whoami.mockReturnValue(null);

    const program = new Command();
    program.exitOverride();
    registerAuthCommands(program);

    await program.parseAsync(['node', 'marty', 'auth', 'whoami']);

    const output = logSpy.mock.calls.map(c => c[0]).join(' ');
    expect(output).toContain('Not logged in');
  });

  it('auth whoami outputs JSON', async () => {
    const { whoami } = await import('../../lib/auth.js');
    const { Command } = await import('commander');
    const { registerAuthCommands } = await import('../../commands/auth.js');

    whoami.mockReturnValue({ type: 'api_key', key: '…xyz' });

    const program = new Command();
    program.exitOverride();
    registerAuthCommands(program);

    await program.parseAsync(['node', 'marty', 'auth', 'whoami', '-o', 'json']);

    const output = logSpy.mock.calls.map(c => c[0]).join('');
    const parsed = JSON.parse(output);
    expect(parsed.type).toBe('api_key');
  });
});
