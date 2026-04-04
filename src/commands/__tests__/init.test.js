/**
 * Tests for cli/commands/init.js — command registration and non-interactive mode.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

vi.mock('../../lib/config.js', () => ({
  loadConfig: vi.fn(() => ({ apiUrl: 'http://localhost:8000', organizationId: null })),
  saveConfig: vi.fn(),
  getConfigDir: vi.fn(() => '/tmp/.marty-test'),
}));

vi.mock('../../lib/auth.js', () => ({
  loginWithApiKey: vi.fn(),
  loginWithClientCredentials: vi.fn(),
  isLoggedIn: vi.fn(() => false),
  whoami: vi.fn(),
}));

vi.mock('../../lib/apiAdapter.js', () => ({
  get: vi.fn(),
}));

vi.mock('../../lib/prompt.js', () => ({
  ask: vi.fn(),
  select: vi.fn(),
  confirm: vi.fn(),
  isInteractive: vi.fn(() => false),
}));

describe('init command', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers the init command on the program', async () => {
    const { registerInitCommand } = await import('../../commands/init.js');

    const commands = [];
    const fakeCmd = {
      command: vi.fn((name) => {
        commands.push(name);
        return {
          description: vi.fn().mockReturnThis(),
          option: vi.fn().mockReturnThis(),
          action: vi.fn().mockReturnThis(),
        };
      }),
    };

    registerInitCommand(fakeCmd);
    expect(commands).toContain('init');
  });

  it('fails in non-interactive mode without --api-key', async () => {
    const { Command } = await import('commander');
    const { registerInitCommand } = await import('../../commands/init.js');

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const program = new Command();
    program.exitOverride();
    registerInitCommand(program);

    try {
      await program.parseAsync(['node', 'marty', 'init']);
    } catch {
      // withErrorHandler calls process.exit(1) via fail()
    }

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('accepts --api-key in non-interactive mode', async () => {
    const { Command } = await import('commander');
    const { registerInitCommand } = await import('../../commands/init.js');
    const { loginWithApiKey } = await import('../../lib/auth.js');
    const { saveConfig } = await import('../../lib/config.js');

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const program = new Command();
    program.exitOverride();
    registerInitCommand(program);

    try {
      await program.parseAsync(['node', 'marty', 'init', '--api-key', 'test-key-123']);
    } catch {
      // Commander may throw on exitOverride
    }

    expect(loginWithApiKey).toHaveBeenCalledWith('test-key-123');
  });
});
