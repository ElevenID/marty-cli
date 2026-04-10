/**
 * Tests for cli/commands/verify.js
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

vi.mock('../../lib/prompt.js', () => ({
  ask: vi.fn(),
  select: vi.fn(),
  isInteractive: vi.fn(() => false),
}));

describe('verify command', () => {
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

  it('registers verify command with subcommands', async () => {
    const { registerVerifyCommands } = await import('../../commands/verify.js');

    const subcommands = [];
    const fakeSubcmd = {
      command: vi.fn(function (name) { subcommands.push(name.split(' ')[0]); return this; }),
      description: vi.fn(function () { return this; }),
      option: vi.fn(function () { return this; }),
      requiredOption: vi.fn(function () { return this; }),
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

    registerVerifyCommands(fakeCmd);
    expect(subcommands).toContain('start');
    expect(subcommands).toContain('status');
    expect(subcommands).toContain('submit');
    expect(subcommands).toContain('evaluate');
    expect(subcommands).toContain('sessions');
    expect(subcommands).toContain('inspect');
  });

  it('verify start --dry-run does not call API', async () => {
    const { post } = await import('../../lib/apiAdapter.js');
    const { Command } = await import('commander');
    const { registerVerifyCommands } = await import('../../commands/verify.js');

    const program = new Command();
    program.exitOverride();
    registerVerifyCommands(program);

    await program.parseAsync([
      'node', 'marty', 'verify', 'start', '--policy', 'pol-1', '--dry-run',
    ]);

    expect(post).not.toHaveBeenCalled();
    const output = logSpy.mock.calls.map(c => c[0]).join(' ');
    expect(output).toContain('dry-run');
  });

  it('verify start posts with policy and org', async () => {
    const { post } = await import('../../lib/apiAdapter.js');
    const { Command } = await import('commander');
    const { registerVerifyCommands } = await import('../../commands/verify.js');

    post.mockResolvedValue({ id: 'session-1', request_uri: 'openid4vp://...' , status: 'pending' });

    const program = new Command();
    program.exitOverride();
    registerVerifyCommands(program);

    await program.parseAsync([
      'node', 'marty', 'verify', 'start', '--policy', 'pol-1',
    ]);

    expect(post).toHaveBeenCalledWith('/v1/flows/verify', {
      presentation_policy_id: 'pol-1',
      organization_id: 'org-1',
    });
    const output = logSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('session-1');
  });

  it('verify start with --trust-profile includes it in body', async () => {
    const { post } = await import('../../lib/apiAdapter.js');
    const { Command } = await import('commander');
    const { registerVerifyCommands } = await import('../../commands/verify.js');

    post.mockResolvedValue({ id: 'session-2', status: 'pending' });

    const program = new Command();
    program.exitOverride();
    registerVerifyCommands(program);

    await program.parseAsync([
      'node', 'marty', 'verify', 'start', '--policy', 'pol-1', '--trust-profile', 'tp-1',
    ]);

    expect(post).toHaveBeenCalledWith('/v1/flows/verify', {
      presentation_policy_id: 'pol-1',
      trust_profile_id: 'tp-1',
      organization_id: 'org-1',
    });
  });

  it('verify status fetches session by ID', async () => {
    const { get } = await import('../../lib/apiAdapter.js');
    const { Command } = await import('commander');
    const { registerVerifyCommands } = await import('../../commands/verify.js');

    get.mockResolvedValue({ id: 'session-1', status: 'completed' });

    const program = new Command();
    program.exitOverride();
    registerVerifyCommands(program);

    await program.parseAsync(['node', 'marty', 'verify', 'status', 'session-1']);

    expect(get).toHaveBeenCalledWith('/v1/flows/instances/session-1');
  });

  it('verify submit --dry-run does not call API', async () => {
    const { post } = await import('../../lib/apiAdapter.js');
    const { Command } = await import('commander');
    const { registerVerifyCommands } = await import('../../commands/verify.js');

    const program = new Command();
    program.exitOverride();
    registerVerifyCommands(program);

    await program.parseAsync([
      'node', 'marty', 'verify', 'submit', 'session-1',
      '--presentation', '{"vp_token":"abc"}', '--dry-run',
    ]);

    expect(post).not.toHaveBeenCalled();
  });

  it('verify submit posts presentation to session', async () => {
    const { post } = await import('../../lib/apiAdapter.js');
    const { Command } = await import('commander');
    const { registerVerifyCommands } = await import('../../commands/verify.js');

    post.mockResolvedValue({ result: 'valid' });

    const program = new Command();
    program.exitOverride();
    registerVerifyCommands(program);

    await program.parseAsync([
      'node', 'marty', 'verify', 'submit', 'session-1',
      '--presentation', '{"vp_token":"abc"}',
    ]);

    expect(post).toHaveBeenCalledWith('/v1/flows/instances/session-1/submit', { vp_token: 'abc' });
  });

  it('verify evaluate --dry-run does not call API', async () => {
    const { post } = await import('../../lib/apiAdapter.js');
    const { Command } = await import('commander');
    const { registerVerifyCommands } = await import('../../commands/verify.js');

    const program = new Command();
    program.exitOverride();
    registerVerifyCommands(program);

    await program.parseAsync([
      'node', 'marty', 'verify', 'evaluate',
      '--credential', '{"type":"VerifiableCredential"}', '--dry-run',
    ]);

    expect(post).not.toHaveBeenCalled();
  });

  it('verify evaluate posts vp_token to the policy evaluation endpoint', async () => {
    const { post } = await import('../../lib/apiAdapter.js');
    const { Command } = await import('commander');
    const { registerVerifyCommands } = await import('../../commands/verify.js');

    post.mockResolvedValue({ valid: true });

    const program = new Command();
    program.exitOverride();
    registerVerifyCommands(program);

    await program.parseAsync([
      'node', 'marty', 'verify', 'evaluate',
      '--credential', '{"type":"VC"}', '--policy', 'pol-1',
    ]);

    expect(post).toHaveBeenCalledWith('/v1/presentation-policies/pol-1/evaluate', {
      vp_token: '{"type":"VC"}',
    });
  });

  it('verify evaluate accepts a raw token string', async () => {
    const { post } = await import('../../lib/apiAdapter.js');
    const { Command } = await import('commander');
    const { registerVerifyCommands } = await import('../../commands/verify.js');

    post.mockResolvedValue({ valid: true });

    const program = new Command();
    program.exitOverride();
    registerVerifyCommands(program);

    await program.parseAsync([
      'node', 'marty', 'verify', 'evaluate',
      '--credential', 'eyJhbGciOiJIUzI1NiJ9.token',
    ]);

    expect(post).toHaveBeenCalledWith('/v1/presentation-policies/evaluate', {
      vp_token: 'eyJhbGciOiJIUzI1NiJ9.token',
    });
  });

  it('verify sessions lists sessions for org', async () => {
    const { get } = await import('../../lib/apiAdapter.js');
    const { Command } = await import('commander');
    const { registerVerifyCommands } = await import('../../commands/verify.js');

    get.mockResolvedValue({
      sessions: [
        { id: 'sess-1', status: 'pending', presentation_policy_id: 'pol-1' },
        { id: 'sess-2', status: 'completed', presentation_policy_id: 'pol-2' },
      ],
    });

    const program = new Command();
    program.exitOverride();
    registerVerifyCommands(program);

    await program.parseAsync(['node', 'marty', 'verify', 'sessions', '-o', 'json']);

    const url = get.mock.calls[0][0];
    expect(url).toContain('/v1/flows/instances');
    expect(url).toContain('organization_id=org-1');
  });

  it('verify inspect fetches inspection result', async () => {
    const { get } = await import('../../lib/apiAdapter.js');
    const { Command } = await import('commander');
    const { registerVerifyCommands } = await import('../../commands/verify.js');

    get.mockResolvedValue({ session_id: 'sess-1', claims: {} });

    const program = new Command();
    program.exitOverride();
    registerVerifyCommands(program);

    await program.parseAsync(['node', 'marty', 'verify', 'inspect', 'sess-1']);

    expect(get).toHaveBeenCalledWith('/v1/flows/instances/sess-1/result');
  });
});
