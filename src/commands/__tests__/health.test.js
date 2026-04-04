/**
 * Tests for cli/commands/health.js
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../lib/apiAdapter.js', () => ({
  get: vi.fn(),
}));

describe('health command', () => {
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

  it('registers health command on the program', async () => {
    const { registerHealthCommand } = await import('../../commands/health.js');

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

    registerHealthCommand(fakeCmd);
    expect(commands).toContain('health');
  });

  it('health outputs JSON when --output json', async () => {
    const { get } = await import('../../lib/apiAdapter.js');
    const { Command } = await import('commander');
    const { registerHealthCommand } = await import('../../commands/health.js');

    get.mockResolvedValue({ status: 'healthy', services: { db: 'ok', redis: 'ok' } });

    const program = new Command();
    program.exitOverride();
    registerHealthCommand(program);

    await program.parseAsync(['node', 'marty', 'health', '-o', 'json']);

    expect(get).toHaveBeenCalledWith('/health');
    const output = logSpy.mock.calls.map(c => c[0]).join('');
    const parsed = JSON.parse(output);
    expect(parsed.status).toBe('healthy');
  });

  it('health shows table with status symbols', async () => {
    const { get } = await import('../../lib/apiAdapter.js');
    const { Command } = await import('commander');
    const { registerHealthCommand } = await import('../../commands/health.js');

    get.mockResolvedValue({
      status: 'healthy',
      services: { database: 'healthy', cache: 'healthy' },
    });

    const program = new Command();
    program.exitOverride();
    registerHealthCommand(program);

    await program.parseAsync(['node', 'marty', 'health']);

    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('healthy');
    expect(output).toContain('●');
  });

  it('health exits 1 for unhealthy status', async () => {
    const { get } = await import('../../lib/apiAdapter.js');
    const { Command } = await import('commander');
    const { registerHealthCommand } = await import('../../commands/health.js');

    get.mockResolvedValue({ status: 'unhealthy' });

    const program = new Command();
    program.exitOverride();
    registerHealthCommand(program);

    await program.parseAsync(['node', 'marty', 'health']);

    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('health does not exit 1 for healthy status', async () => {
    const { get } = await import('../../lib/apiAdapter.js');
    const { Command } = await import('commander');
    const { registerHealthCommand } = await import('../../commands/health.js');

    get.mockResolvedValue({ status: 'ok' });

    const program = new Command();
    program.exitOverride();
    registerHealthCommand(program);

    await program.parseAsync(['node', 'marty', 'health']);

    expect(exitSpy).not.toHaveBeenCalledWith(1);
  });

  it('health handles services as strings', async () => {
    const { get } = await import('../../lib/apiAdapter.js');
    const { Command } = await import('commander');
    const { registerHealthCommand } = await import('../../commands/health.js');

    get.mockResolvedValue({
      status: 'degraded',
      services: { db: 'healthy', cache: { status: 'degraded' } },
    });

    const program = new Command();
    program.exitOverride();
    registerHealthCommand(program);

    await program.parseAsync(['node', 'marty', 'health']);

    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('degraded');
    expect(output).toContain('◐');
  });
});
