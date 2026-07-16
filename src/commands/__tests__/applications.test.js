import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('../../lib/prompt.js', () => ({
  select: vi.fn(),
  isInteractive: vi.fn(() => false),
}));

describe('canonical applications command', () => {
  let logSpy;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  async function program() {
    const { Command } = await import('commander');
    const { registerApplicationsCommands } = await import('../../commands/applications.js');
    const command = new Command();
    command.exitOverride();
    registerApplicationsCommands(command);
    return command;
  }

  it('registers holder and organization lifecycle commands', async () => {
    const command = await program();
    const applications = command.commands.find((entry) => entry.name() === 'applications');
    const names = applications.commands.map((entry) => entry.name());

    expect(names).toEqual(expect.arrayContaining([
      'list', 'inspect', 'apply', 'submit', 'withdraw', 'claim',
      'approve', 'reject', 'request-info', 'issue',
    ]));
  });

  it('lists personal applications through /v1/me', async () => {
    const { get } = await import('../../lib/apiAdapter.js');
    get.mockResolvedValue({
      items: [{ id: 'app-1', application_template_id: 'template-1', status: 'SUBMITTED' }],
      total: 1,
    });

    const command = await program();
    await command.parseAsync(['node', 'marty', 'applications', 'list', '-o', 'json']);

    expect(get).toHaveBeenCalledWith('/v1/me/applications?limit=50');
    expect(JSON.parse(logSpy.mock.calls.map((call) => call[0]).join(''))[0].id).toBe('app-1');
  });

  it('filters personal status without sending an unsupported query field', async () => {
    const { get } = await import('../../lib/apiAdapter.js');
    get.mockResolvedValue({ items: [
      { id: 'draft', status: 'DRAFT' },
      { id: 'approved', status: 'APPROVED' },
    ] });

    const command = await program();
    await command.parseAsync([
      'node', 'marty', 'applications', 'list', '--status', 'approved', '-o', 'json',
    ]);

    expect(get).toHaveBeenCalledWith('/v1/me/applications?limit=50');
    expect(JSON.parse(logSpy.mock.calls.map((call) => call[0]).join(''))).toEqual([
      { id: 'approved', status: 'APPROVED' },
    ]);
  });

  it('lists organization applications through the selected organization', async () => {
    const { get } = await import('../../lib/apiAdapter.js');
    get.mockResolvedValue([{ id: 'org-app-1', status: 'UNDER_REVIEW' }]);

    const command = await program();
    await command.parseAsync(['node', 'marty', 'applications', 'list', '--org', '-o', 'json']);

    expect(get.mock.calls[0][0]).toBe('/v1/organizations/org-1/applicants?limit=50');
  });

  it('inspects self-service and reviewer resources explicitly', async () => {
    const { get } = await import('../../lib/apiAdapter.js');
    get.mockResolvedValue({ id: 'app-42' });
    const command = await program();

    await command.parseAsync(['node', 'marty', 'applications', 'inspect', 'app-42']);
    await command.parseAsync(['node', 'marty', 'applications', 'inspect', 'app-42', '--org']);

    expect(get).toHaveBeenNthCalledWith(1, '/v1/me/applications/app-42');
    expect(get).toHaveBeenNthCalledWith(2, '/v1/organizations/org-1/applicants/app-42');
  });

  it('creates, submits, and claims only with the canonical request contract', async () => {
    const { get, post } = await import('../../lib/apiAdapter.js');
    get.mockResolvedValue({ items: [] });
    post
      .mockResolvedValueOnce({ id: 'app-42', status: 'DRAFT' })
      .mockResolvedValueOnce({ id: 'app-42', status: 'APPROVED', claim_state: 'OFFER_READY' })
      .mockResolvedValueOnce({ id: 'app-42', claim_state: 'OFFER_READY', credential_offer_uri: 'openid-credential-offer://ready' });

    const command = await program();
    await command.parseAsync([
      'node', 'marty', 'applications', 'apply', 'application-template-1',
      '--form-data', '{"email":"holder@example.test"}',
      '--integration-context', '{"source":"cli-test"}',
      '-o', 'json',
    ]);

    expect(post).toHaveBeenNthCalledWith(1, '/v1/me/applications', {
      organization_id: 'org-1',
      application_template_id: 'application-template-1',
      form_data: { email: 'holder@example.test' },
      integration_context: { source: 'cli-test' },
    });
    expect(post).toHaveBeenNthCalledWith(2, '/v1/me/applications/app-42/submit', {});
    expect(post).toHaveBeenNthCalledWith(3, '/v1/me/applications/app-42/claim', {});
    const body = post.mock.calls[0][1];
    expect(body).not.toHaveProperty('applicant_id');
    expect(body).not.toHaveProperty('credential_configuration_id');
    expect(body).not.toHaveProperty('issuing_authority');
    expect(body).not.toHaveProperty('metadata');
  });

  it('does not claim a submitted application that is not offer-ready', async () => {
    const { get, post } = await import('../../lib/apiAdapter.js');
    get.mockResolvedValue({ items: [] });
    post
      .mockResolvedValueOnce({ id: 'app-42', status: 'DRAFT' })
      .mockResolvedValueOnce({ id: 'app-42', status: 'SUBMITTED', claim_state: 'NOT_READY' });

    const command = await program();
    await command.parseAsync(['node', 'marty', 'applications', 'apply', 'application-template-1']);

    expect(post).toHaveBeenCalledTimes(2);
  });

  it('claims an existing offer-ready application instead of duplicating it', async () => {
    const { get, post } = await import('../../lib/apiAdapter.js');
    get.mockResolvedValue({ items: [{
      id: 'existing-1',
      application_template_id: 'application-template-1',
      status: 'APPROVED',
      claim_state: 'OFFER_READY',
    }] });
    post.mockResolvedValue({ id: 'existing-1', credential_offer_uri: 'openid-credential-offer://fresh' });

    const command = await program();
    await command.parseAsync(['node', 'marty', 'applications', 'apply', 'application-template-1']);

    expect(post).toHaveBeenCalledOnce();
    expect(post).toHaveBeenCalledWith('/v1/me/applications/existing-1/claim', {});
  });

  it('acquires and releases the reviewer lock around approval', async () => {
    const { post, del } = await import('../../lib/apiAdapter.js');
    post.mockResolvedValue({});
    del.mockResolvedValue({ released: true });

    const command = await program();
    await command.parseAsync(['node', 'marty', 'applications', 'approve', 'app-42', '--notes', 'looks good']);

    const base = '/v1/organizations/org-1/applicants/app-42';
    expect(post).toHaveBeenNthCalledWith(1, `${base}/lock`, {});
    expect(post).toHaveBeenNthCalledWith(2, `${base}/approve`, { notes: 'looks good' });
    expect(del).toHaveBeenCalledWith(`${base}/lock`);
  });

  it('releases the reviewer lock when a decision fails', async () => {
    const { post, del } = await import('../../lib/apiAdapter.js');
    post.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('decision failed'));
    del.mockResolvedValue({ released: true });

    const command = await program();
    await command.parseAsync([
      'node', 'marty', 'applications', 'reject', 'app-42', '--reason', 'incomplete',
    ]);

    expect(del).toHaveBeenCalledWith('/v1/organizations/org-1/applicants/app-42/lock');
  });

  it('requests information under a reviewer lock', async () => {
    const { post, del } = await import('../../lib/apiAdapter.js');
    post.mockResolvedValue({});
    del.mockResolvedValue({ released: true });

    const command = await program();
    await command.parseAsync([
      'node', 'marty', 'applications', 'request-info', 'app-42',
      '--message', 'Upload proof', '--missing', 'proof_of_address',
    ]);

    expect(post).toHaveBeenNthCalledWith(
      2,
      '/v1/organizations/org-1/applicants/app-42/request-information',
      { message: 'Upload proof', missing_items: ['proof_of_address'] },
    );
    expect(del).toHaveBeenCalledOnce();
  });

  it('initiates issuance through the organization resource', async () => {
    const { post } = await import('../../lib/apiAdapter.js');
    post.mockResolvedValue({ id: 'app-42', claim_state: 'OFFER_READY' });

    const command = await program();
    await command.parseAsync(['node', 'marty', 'applications', 'issue', 'app-42']);

    expect(post).toHaveBeenCalledWith('/v1/organizations/org-1/applicants/app-42/issue', {});
  });

  it('never contains a removed applicant route', async () => {
    const source = await import('node:fs/promises').then((fs) => fs.readFile(
      new URL('../../commands/applications.js', import.meta.url),
      'utf8',
    ));

    expect(source).not.toContain('/v1/applicants');
    expect(source).not.toContain('credential_configuration_id');
  });
});
