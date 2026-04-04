/**
 * Tests for cli/commands/config.js (the config command, not lib/config.js)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../lib/config.js', () => ({
  loadConfig: vi.fn(() => ({
    apiUrl: 'http://localhost:8000',
    organizationId: 'org-1',
  })),
  saveConfig: vi.fn(),
  getConfigDir: vi.fn(() => '/home/user/.marty'),
}));

describe('config command', () => {
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

  it('registers config command with show and set', async () => {
    const { registerConfigCommands } = await import('../../commands/config.js');

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

    registerConfigCommands(fakeCmd);
    expect(subcommands).toContain('show');
    expect(subcommands).toContain('set');
  });

  it('config show outputs current config as JSON', async () => {
    const { Command } = await import('commander');
    const { registerConfigCommands } = await import('../../commands/config.js');

    const program = new Command();
    program.exitOverride();
    registerConfigCommands(program);

    await program.parseAsync(['node', 'marty', 'config', 'show', '-o', 'json']);

    const output = logSpy.mock.calls.map(c => c[0]).join('');
    const parsed = JSON.parse(output);
    expect(parsed.apiUrl).toBe('http://localhost:8000');
    expect(parsed.organizationId).toBe('org-1');
    expect(parsed.configDir).toBe('/home/user/.marty');
  });

  it('config show renders table format', async () => {
    const { Command } = await import('commander');
    const { registerConfigCommands } = await import('../../commands/config.js');

    const program = new Command();
    program.exitOverride();
    registerConfigCommands(program);

    await program.parseAsync(['node', 'marty', 'config', 'show']);

    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('apiUrl');
    expect(output).toContain('http://localhost:8000');
  });

  it('config set saves allowed key', async () => {
    const { saveConfig } = await import('../../lib/config.js');
    const { Command } = await import('commander');
    const { registerConfigCommands } = await import('../../commands/config.js');

    const program = new Command();
    program.exitOverride();
    registerConfigCommands(program);

    await program.parseAsync(['node', 'marty', 'config', 'set', 'apiUrl', 'https://api.example.com']);

    expect(saveConfig).toHaveBeenCalledWith({ apiUrl: 'https://api.example.com' });
    const output = logSpy.mock.calls.map(c => c[0]).join(' ');
    expect(output).toContain('apiUrl');
    expect(output).toContain('https://api.example.com');
  });

  it('config set saves organizationId', async () => {
    const { saveConfig } = await import('../../lib/config.js');
    const { Command } = await import('commander');
    const { registerConfigCommands } = await import('../../commands/config.js');

    const program = new Command();
    program.exitOverride();
    registerConfigCommands(program);

    await program.parseAsync(['node', 'marty', 'config', 'set', 'organizationId', 'org-99']);

    expect(saveConfig).toHaveBeenCalledWith({ organizationId: 'org-99' });
  });

  it('config set rejects unknown keys', async () => {
    const { Command } = await import('commander');
    const { registerConfigCommands } = await import('../../commands/config.js');

    // process.exit is mocked to no-op, so execution continues after the guard.
    // Verify that the error message and exit code are correct.
    const program = new Command();
    program.exitOverride();
    registerConfigCommands(program);

    await program.parseAsync(['node', 'marty', 'config', 'set', 'badKey', 'value']);

    expect(exitSpy).toHaveBeenCalledWith(2);
    const output = errSpy.mock.calls.map(c => c[0]).join(' ');
    expect(output).toContain('Unknown key');
  });
});
