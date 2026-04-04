/**
 * Tests for cli/commands/completion.js
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('completion command', () => {
  let logSpy;

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('generates bash completion script', async () => {
    const { Command } = await import('commander');
    const { registerCompletionCommand } = await import('../../commands/completion.js');

    const program = new Command();
    program.exitOverride();
    registerCompletionCommand(program);

    await program.parseAsync(['node', 'marty', 'completion', 'bash']);

    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('_marty_completions');
    expect(output).toContain('complete -F');
  });

  it('generates zsh completion script', async () => {
    const { Command } = await import('commander');
    const { registerCompletionCommand } = await import('../../commands/completion.js');

    const program = new Command();
    program.exitOverride();
    registerCompletionCommand(program);

    await program.parseAsync(['node', 'marty', 'completion', 'zsh']);

    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('#compdef marty');
    expect(output).toContain('_marty');
  });

  it('generates fish completion script', async () => {
    const { Command } = await import('commander');
    const { registerCompletionCommand } = await import('../../commands/completion.js');

    const program = new Command();
    program.exitOverride();
    registerCompletionCommand(program);

    await program.parseAsync(['node', 'marty', 'completion', 'fish']);

    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('complete -c marty');
    expect(output).toContain('__fish_seen_subcommand_from');
  });
});
