/**
 * Tests for cli/commands/templates.js
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
}));

describe('templates command', () => {
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

  it('registers templates command with list and inspect', async () => {
    const { registerTemplatesCommands } = await import('../../commands/templates.js');

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

    registerTemplatesCommands(fakeCmd);
    expect(subcommands).toContain('list');
    expect(subcommands).toContain('inspect');
  });

  it('templates list outputs JSON', async () => {
    const { get } = await import('../../lib/apiAdapter.js');
    const { Command } = await import('commander');
    const { registerTemplatesCommands } = await import('../../commands/templates.js');

    get.mockResolvedValue({
      templates: [
        { id: 'tpl-1', name: 'Driver License', credential_type: 'mDL', status: 'active' },
        { id: 'tpl-2', name: 'Passport', credential_type: 'Passport', status: 'draft' },
      ],
    });

    const program = new Command();
    program.exitOverride();
    registerTemplatesCommands(program);

    await program.parseAsync(['node', 'marty', 'templates', 'list', '-o', 'json']);

    const url = get.mock.calls[0][0];
    expect(url).toContain('/v1/application-templates');
    expect(url).toContain('organization_id=org-1');

    const output = logSpy.mock.calls.map(c => c[0]).join('');
    const parsed = JSON.parse(output);
    expect(parsed).toHaveLength(2);
  });

  it('templates list fails without organization', async () => {
    const { loadConfig } = await import('../../lib/config.js');
    loadConfig.mockReturnValue({ apiUrl: 'http://localhost:8000', organizationId: null });

    const { Command } = await import('commander');
    const { registerTemplatesCommands } = await import('../../commands/templates.js');

    const program = new Command();
    program.exitOverride();
    registerTemplatesCommands(program);

    await program.parseAsync(['node', 'marty', 'templates', 'list']);

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('templates inspect fetches by ID', async () => {
    const { get } = await import('../../lib/apiAdapter.js');
    const { Command } = await import('commander');
    const { registerTemplatesCommands } = await import('../../commands/templates.js');

    get.mockResolvedValue({ id: 'tpl-42', name: 'Test Template' });

    const program = new Command();
    program.exitOverride();
    registerTemplatesCommands(program);

    await program.parseAsync(['node', 'marty', 'templates', 'inspect', 'tpl-42']);

    expect(get).toHaveBeenCalledWith('/v1/application-templates/tpl-42');
    const output = logSpy.mock.calls.map(c => c[0]).join('');
    const parsed = JSON.parse(output);
    expect(parsed.name).toBe('Test Template');
  });
});
