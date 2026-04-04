/**
 * Tests for cli/commands/flows.js
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

describe('flows command', () => {
  let logSpy, errSpy;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('registers flows command with list and inspect', async () => {
    const { registerFlowsCommands } = await import('../../commands/flows.js');

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

    registerFlowsCommands(fakeCmd);
    expect(subcommands).toContain('list');
    expect(subcommands).toContain('inspect');
  });

  it('flows list outputs JSON with org and limit', async () => {
    const { get } = await import('../../lib/apiAdapter.js');
    const { Command } = await import('commander');
    const { registerFlowsCommands } = await import('../../commands/flows.js');

    get.mockResolvedValue({
      flows: [
        { id: 'flow-1', name: 'Onboarding', flow_type: 'issuance', status: 'active' },
        { id: 'flow-2', name: 'Verification', flow_type: 'verification', status: 'active' },
      ],
    });

    const program = new Command();
    program.exitOverride();
    registerFlowsCommands(program);

    await program.parseAsync(['node', 'marty', 'flows', 'list', '-o', 'json', '--limit', '25']);

    const url = get.mock.calls[0][0];
    expect(url).toContain('/v1/flows');
    expect(url).toContain('limit=25');
    expect(url).toContain('organization_id=org-1');

    const output = logSpy.mock.calls.map(c => c[0]).join('');
    const parsed = JSON.parse(output);
    expect(parsed).toHaveLength(2);
  });

  it('flows list handles array response', async () => {
    const { get } = await import('../../lib/apiAdapter.js');
    const { Command } = await import('commander');
    const { registerFlowsCommands } = await import('../../commands/flows.js');

    get.mockResolvedValue([{ id: 'flow-1', name: 'Test' }]);

    const program = new Command();
    program.exitOverride();
    registerFlowsCommands(program);

    await program.parseAsync(['node', 'marty', 'flows', 'list', '-o', 'json']);

    const output = logSpy.mock.calls.map(c => c[0]).join('');
    const parsed = JSON.parse(output);
    expect(parsed).toHaveLength(1);
  });

  it('flows list renders table with correct columns', async () => {
    const { get } = await import('../../lib/apiAdapter.js');
    const { Command } = await import('commander');
    const { registerFlowsCommands } = await import('../../commands/flows.js');

    get.mockResolvedValue({
      flows: [
        { id: 'flow-1', name: 'Onboarding', flow_type: 'issuance', status: 'active' },
      ],
    });

    const program = new Command();
    program.exitOverride();
    registerFlowsCommands(program);

    await program.parseAsync(['node', 'marty', 'flows', 'list']);

    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('Onboarding');
    expect(output).toContain('issuance');
  });

  it('flows inspect fetches by ID', async () => {
    const { get } = await import('../../lib/apiAdapter.js');
    const { Command } = await import('commander');
    const { registerFlowsCommands } = await import('../../commands/flows.js');

    get.mockResolvedValue({ id: 'flow-42', name: 'Custom Flow', steps: [] });

    const program = new Command();
    program.exitOverride();
    registerFlowsCommands(program);

    await program.parseAsync(['node', 'marty', 'flows', 'inspect', 'flow-42']);

    expect(get).toHaveBeenCalledWith('/v1/flows/flow-42');
    const output = logSpy.mock.calls.map(c => c[0]).join('');
    const parsed = JSON.parse(output);
    expect(parsed.name).toBe('Custom Flow');
  });
});
