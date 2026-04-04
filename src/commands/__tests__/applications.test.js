/**
 * Tests for cli/commands/applications.js
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../lib/apiAdapter.js', () => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
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

vi.mock('../../lib/prompt.js', () => ({
  ask: vi.fn(),
  select: vi.fn(),
  isInteractive: vi.fn(() => false),
}));

describe('applications command', () => {
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

  it('registers applications command with subcommands', async () => {
    const { registerApplicationsCommands } = await import('../../commands/applications.js');

    const subcommands = [];

    const fakeSubcmd = {
      command: vi.fn(function (name) { subcommands.push(name.split(' ')[0]); return this; }),
      alias: vi.fn(function () { return this; }),
      description: vi.fn(function () { return this; }),
      option: vi.fn(function () { return this; }),
      requiredOption: vi.fn(function () { return this; }),
      action: vi.fn(function () { return this; }),
    };

    const fakeCmd = {
      command: vi.fn(() => ({
        ...fakeSubcmd,
        alias: vi.fn().mockReturnValue({
          ...fakeSubcmd,
          command: vi.fn((n) => { subcommands.push(n.split(' ')[0]); return fakeSubcmd; }),
        }),
        description: vi.fn().mockReturnValue({
          ...fakeSubcmd,
          command: vi.fn((n) => { subcommands.push(n.split(' ')[0]); return fakeSubcmd; }),
        }),
      })),
    };

    registerApplicationsCommands(fakeCmd);
    expect(subcommands).toContain('list');
    expect(subcommands).toContain('inspect');
    expect(subcommands).toContain('apply');
    expect(subcommands).toContain('approve');
    expect(subcommands).toContain('reject');
    expect(subcommands).toContain('issue');
  });

  it('applications list outputs JSON for personal apps', async () => {
    const { get } = await import('../../lib/apiAdapter.js');
    const { Command } = await import('commander');
    const { registerApplicationsCommands } = await import('../../commands/applications.js');

    // /v1/auth/me
    get.mockResolvedValueOnce({ user_id: 'user-1' });
    // /v1/applicants/by-user/user-1
    get.mockResolvedValueOnce({ id: 'app-profile-1' });
    // /v1/applicants/<id>/applications
    get.mockResolvedValueOnce({
      applications: [
        { id: 'app-1', credential_configuration_id: 'DriverLicense', status: 'approved', created_at: '2026-01-01T00:00:00Z' },
      ],
    });

    const program = new Command();
    program.exitOverride();
    registerApplicationsCommands(program);

    await program.parseAsync(['node', 'marty', 'applications', 'list', '-o', 'json']);

    const output = logSpy.mock.calls.map(c => c[0]).join('');
    const parsed = JSON.parse(output);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe('app-1');
  });

  it('applications list --org lists org applications', async () => {
    const { get } = await import('../../lib/apiAdapter.js');
    const { Command } = await import('commander');
    const { registerApplicationsCommands } = await import('../../commands/applications.js');

    get.mockResolvedValue({
      applications: [
        { id: 'org-app-1', status: 'pending' },
        { id: 'org-app-2', status: 'approved' },
      ],
    });

    const program = new Command();
    program.exitOverride();
    registerApplicationsCommands(program);

    await program.parseAsync(['node', 'marty', 'applications', 'list', '--org', '-o', 'json']);

    const url = get.mock.calls[0][0];
    expect(url).toContain('/v1/applicants/org-applications');
    expect(url).toContain('organization_id=org-1');
  });

  it('applications inspect fetches by ID', async () => {
    const { get } = await import('../../lib/apiAdapter.js');
    const { Command } = await import('commander');
    const { registerApplicationsCommands } = await import('../../commands/applications.js');

    get.mockResolvedValue({ id: 'app-42', status: 'approved' });

    const program = new Command();
    program.exitOverride();
    registerApplicationsCommands(program);

    await program.parseAsync(['node', 'marty', 'applications', 'inspect', 'app-42']);

    expect(get).toHaveBeenCalledWith('/v1/applicants/applications/app-42');
  });

  it('applications approve --dry-run does not call API', async () => {
    const { post } = await import('../../lib/apiAdapter.js');
    const { Command } = await import('commander');
    const { registerApplicationsCommands } = await import('../../commands/applications.js');

    const program = new Command();
    program.exitOverride();
    registerApplicationsCommands(program);

    await program.parseAsync(['node', 'marty', 'applications', 'approve', 'app-42', '--dry-run']);

    expect(post).not.toHaveBeenCalled();
    const output = logSpy.mock.calls.map(c => c[0]).join(' ');
    expect(output).toContain('dry-run');
  });

  it('applications approve posts to approve endpoint', async () => {
    const { post } = await import('../../lib/apiAdapter.js');
    const { Command } = await import('commander');
    const { registerApplicationsCommands } = await import('../../commands/applications.js');

    post.mockResolvedValue({ ok: true });

    const program = new Command();
    program.exitOverride();
    registerApplicationsCommands(program);

    await program.parseAsync([
      'node', 'marty', 'applications', 'approve', 'app-42', '--notes', 'looks good',
    ]);

    expect(post).toHaveBeenCalledWith(
      '/v1/applicants/applications/app-42/approve',
      { notes: 'looks good' },
    );
  });

  it('applications reject --dry-run does not call API', async () => {
    const { post } = await import('../../lib/apiAdapter.js');
    const { Command } = await import('commander');
    const { registerApplicationsCommands } = await import('../../commands/applications.js');

    const program = new Command();
    program.exitOverride();
    registerApplicationsCommands(program);

    await program.parseAsync(['node', 'marty', 'applications', 'reject', 'app-42', '--dry-run']);

    expect(post).not.toHaveBeenCalled();
  });

  it('applications reject posts reason', async () => {
    const { post } = await import('../../lib/apiAdapter.js');
    const { Command } = await import('commander');
    const { registerApplicationsCommands } = await import('../../commands/applications.js');

    post.mockResolvedValue({ ok: true });

    const program = new Command();
    program.exitOverride();
    registerApplicationsCommands(program);

    await program.parseAsync([
      'node', 'marty', 'applications', 'reject', 'app-42', '--reason', 'incomplete docs',
    ]);

    expect(post).toHaveBeenCalledWith(
      '/v1/applicants/applications/app-42/reject',
      { reason: 'incomplete docs' },
    );
  });

  it('applications issue --dry-run does not call API', async () => {
    const { post } = await import('../../lib/apiAdapter.js');
    const { Command } = await import('commander');
    const { registerApplicationsCommands } = await import('../../commands/applications.js');

    const program = new Command();
    program.exitOverride();
    registerApplicationsCommands(program);

    await program.parseAsync(['node', 'marty', 'applications', 'issue', 'app-42', '--dry-run']);

    expect(post).not.toHaveBeenCalled();
  });

  it('applications issue posts to issue endpoint', async () => {
    const { post } = await import('../../lib/apiAdapter.js');
    const { Command } = await import('commander');
    const { registerApplicationsCommands } = await import('../../commands/applications.js');

    post.mockResolvedValue({ credential_offer_uri: 'openid-credential-offer://...' });

    const program = new Command();
    program.exitOverride();
    registerApplicationsCommands(program);

    await program.parseAsync(['node', 'marty', 'applications', 'issue', 'app-42']);

    expect(post).toHaveBeenCalledWith('/v1/applicants/applications/app-42/issue');
  });
});
