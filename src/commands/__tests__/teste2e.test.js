/**
 * Tests for cli/commands/teste2e.js — TestRunner and e2e command registration.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the API adapter before importing the module
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

vi.mock('../../lib/auth.js', () => ({
  isLoggedIn: vi.fn(() => true),
  getAuthHeaders: vi.fn(() => ({ 'X-API-Key': 'test-key' })),
}));

describe('test:e2e command registration', () => {
  it('registers test command group with e2e and health subcommands', async () => {
    const { registerTestCommands } = await import('../../commands/teste2e.js');

    const commands = [];
    const subcommands = [];

    const fakeSubcmd = {
      command: vi.fn(function (name) {
        subcommands.push(name);
        return this;
      }),
      description: vi.fn(function () { return this; }),
      option: vi.fn(function () { return this; }),
      action: vi.fn(function () { return this; }),
    };

    const fakeCmd = {
      command: vi.fn((name) => {
        commands.push(name);
        return fakeSubcmd;
      }),
      description: vi.fn(function () { return fakeSubcmd; }),
    };

    registerTestCommands(fakeCmd);
    expect(commands).toContain('test');
    expect(subcommands).toContain('e2e');
    expect(subcommands).toContain('health');
  });
});

describe('e2e scenario dry-run', () => {
  let logSpy;
  let exitSpy;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('dry-run mode should not call API', async () => {
    const { get, post } = await import('../../lib/apiAdapter.js');

    // Import the command module to access the TestRunner indirectly
    // The e2e command uses --dry-run, so we test by invoking via Commander
    const { Command } = await import('commander');
    const { registerTestCommands } = await import('../../commands/teste2e.js');

    const program = new Command();
    program.exitOverride();
    registerTestCommands(program);

    try {
      await program.parseAsync(['node', 'marty', 'test', 'e2e', '--dry-run', '--scenario', 'health']);
    } catch {
      // Commander may throw on exitOverride
    }

    // In dry-run mode, no actual API calls should be made
    expect(get).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
  });
});
