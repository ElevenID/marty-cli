/**
 * Tests for cli/commands/orgs.js
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../lib/apiAdapter.js', () => ({
  get: vi.fn(),
}));

vi.mock('../../lib/config.js', () => ({
  loadConfig: vi.fn(() => ({
    apiUrl: 'http://localhost:8000',
    organizationId: 'org-1',
  })),
  saveConfig: vi.fn(),
}));

describe('orgs command', () => {
  let logSpy, errSpy;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('orgs list outputs JSON', async () => {
    const { get } = await import('../../lib/apiAdapter.js');
    const { Command } = await import('commander');
    const { registerOrgsCommands } = await import('../../commands/orgs.js');

    get.mockResolvedValue({
      organizations: [
        { id: 'org-1', name: 'Acme Corp', role: 'admin' },
        { id: 'org-2', name: 'Globex', role: 'member' },
      ],
    });

    const program = new Command();
    program.exitOverride();
    registerOrgsCommands(program);

    await program.parseAsync(['node', 'marty', 'orgs', 'list', '-o', 'json']);

    expect(get).toHaveBeenCalledWith('/v1/organizations');
    const output = logSpy.mock.calls.map(c => c[0]).join('');
    const parsed = JSON.parse(output);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].name).toBe('Acme Corp');
  });

  it('orgs list handles array response', async () => {
    const { get } = await import('../../lib/apiAdapter.js');
    const { Command } = await import('commander');
    const { registerOrgsCommands } = await import('../../commands/orgs.js');

    get.mockResolvedValue([
      { id: 'org-1', name: 'Acme Corp' },
    ]);

    const program = new Command();
    program.exitOverride();
    registerOrgsCommands(program);

    await program.parseAsync(['node', 'marty', 'orgs', 'list', '-o', 'json']);

    const output = logSpy.mock.calls.map(c => c[0]).join('');
    const parsed = JSON.parse(output);
    expect(parsed).toHaveLength(1);
  });

  it('orgs switch saves organizationId', async () => {
    const { saveConfig } = await import('../../lib/config.js');
    const { Command } = await import('commander');
    const { registerOrgsCommands } = await import('../../commands/orgs.js');

    const program = new Command();
    program.exitOverride();
    registerOrgsCommands(program);

    await program.parseAsync(['node', 'marty', 'orgs', 'switch', 'org-99']);

    expect(saveConfig).toHaveBeenCalledWith({ organizationId: 'org-99' });
    const output = logSpy.mock.calls.map(c => c[0]).join(' ');
    expect(output).toContain('org-99');
  });

  it('orgs current prints active organization', async () => {
    const { Command } = await import('commander');
    const { registerOrgsCommands } = await import('../../commands/orgs.js');

    const program = new Command();
    program.exitOverride();
    registerOrgsCommands(program);

    await program.parseAsync(['node', 'marty', 'orgs', 'current']);

    expect(logSpy).toHaveBeenCalledWith('org-1');
  });

  it('orgs current prints help when no org set', async () => {
    const { loadConfig } = await import('../../lib/config.js');
    const { Command } = await import('commander');

    loadConfig.mockReturnValue({ apiUrl: 'http://localhost:8000', organizationId: null });

    const { registerOrgsCommands } = await import('../../commands/orgs.js');

    const program = new Command();
    program.exitOverride();
    registerOrgsCommands(program);

    await program.parseAsync(['node', 'marty', 'orgs', 'current']);

    const output = logSpy.mock.calls.map(c => c[0]).join(' ');
    expect(output).toContain('No active organization');
  });
});
