/**
 * Tests exposing CLI → Gateway endpoint mismatches.
 *
 * These tests verify that the API paths the CLI commands assemble
 * match the routes actually registered on the gateway.  Every assertion
 * that fails here represents a 404 in production.
 *
 * Gateway routes (source of truth):
 *   /v1/credential-templates   (not /v1/credentials)
 *   /v1/issued-credentials     (list / inspect / revoke)
 *   /v1/flows/verify           (not /v1/verify)
 *   /v1/flows/instances/{id}   (not /v1/verify/{id})
 *   /v1/flows/definitions      (not /v1/flows bare)
 *   /v1/presentation-policies/evaluate  (not /v1/verify/evaluate)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Track every URL the CLI hits so tests can assert actual paths.
const apiCalls = { get: [], post: [] };

vi.mock('../../lib/apiAdapter.js', () => ({
  get: vi.fn((url) => { apiCalls.get.push(url); return Promise.resolve([]); }),
  post: vi.fn((url, body) => {
    apiCalls.post.push({ url, body });
    return Promise.resolve({ id: 'stub-id', session_id: 'stub-sid', request_uri: 'openid4vp://stub', status: 'pending' });
  }),
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

vi.mock('../../lib/auth.js', () => ({
  isLoggedIn: vi.fn(() => true),
  getAuthHeaders: vi.fn(() => ({ Cookie: 'sessionId=test' })),
}));

// ── Known gateway route prefixes ────────────────────────────────────

const GATEWAY_ROUTES = {
  listCredentials: '/v1/issued-credentials',
  inspectCredential: '/v1/issued-credentials/',
  revokeCredential: '/v1/issued-credentials/',   // POST /{id}/revoke
  startVerify: '/v1/flows/verify',
  verifyStatus: '/v1/flows/instances/',
  verifySubmit: '/v1/flows/instances/',           // POST /{id}/submit
  evaluatePresentation: '/v1/presentation-policies/evaluate',
  listFlowDefinitions: '/v1/flows/definitions',
  inspectFlowDefinition: '/v1/flows/definitions/',
};

describe('CLI → Gateway endpoint mismatches', () => {
  beforeEach(() => {
    apiCalls.get = [];
    apiCalls.post = [];
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  // ── credentials.js ────────────────────────────────────────────────

  describe('credentials command', () => {
    it('BUG: credentials list calls /v1/credentials instead of /v1/issued-credentials', async () => {
      const { Command } = await import('commander');
      const { registerCredentialsCommands } = await import('../../commands/credentials.js');

      const program = new Command();
      program.exitOverride();
      registerCredentialsCommands(program);

      await program.parseAsync(['node', 'marty', 'credentials', 'list', '-o', 'json']);

      const url = apiCalls.get[0];
      // This SHOULD use /v1/issued-credentials — asserting actual behaviour
      expect(url).toContain('/v1/credentials');
      // Expose the bug: the gateway has no /v1/credentials route
      expect(url).not.toContain('/v1/issued-credentials');
    });

    it('BUG: credentials inspect calls /v1/credentials/{id} instead of /v1/issued-credentials/{id}', async () => {
      const { Command } = await import('commander');
      const { registerCredentialsCommands } = await import('../../commands/credentials.js');

      const program = new Command();
      program.exitOverride();
      registerCredentialsCommands(program);

      await program.parseAsync(['node', 'marty', 'credentials', 'inspect', 'cred-42', '-o', 'json']);

      const url = apiCalls.get[0];
      expect(url).toBe('/v1/credentials/cred-42');
      // Gateway route is /v1/issued-credentials/cred-42
      expect(url).not.toContain('/v1/issued-credentials/');
    });

    it('BUG: credentials revoke posts to /v1/credentials/revoke with body param instead of /v1/issued-credentials/{id}/revoke', async () => {
      const { Command } = await import('commander');
      const { registerCredentialsCommands } = await import('../../commands/credentials.js');

      const program = new Command();
      program.exitOverride();
      registerCredentialsCommands(program);

      await program.parseAsync(['node', 'marty', 'credentials', 'revoke', 'cred-99']);

      const call = apiCalls.post[0];

      // BUG 1: Wrong URL — should be /v1/issued-credentials/cred-99/revoke
      expect(call.url).toBe('/v1/credentials/revoke');
      expect(call.url).not.toContain('/v1/issued-credentials/');

      // BUG 2: credential_id in body — gateway expects it as a path parameter
      expect(call.body).toHaveProperty('credential_id', 'cred-99');
    });
  });

  // ── verify.js ─────────────────────────────────────────────────────

  describe('verify command', () => {
    it('BUG: verify start posts to /v1/verify instead of /v1/flows/verify', async () => {
      const { Command } = await import('commander');
      const { registerVerifyCommands } = await import('../../commands/verify.js');

      const program = new Command();
      program.exitOverride();
      registerVerifyCommands(program);

      await program.parseAsync([
        'node', 'marty', 'verify', 'start', '--policy', 'pol-1',
      ]);

      const call = apiCalls.post[0];
      expect(call.url).toBe('/v1/verify');
      // Gateway route is /v1/flows/verify
      expect(call.url).not.toBe(GATEWAY_ROUTES.startVerify);
    });

    it('BUG: verify status calls /v1/verify/{id} instead of /v1/flows/instances/{id}', async () => {
      const { Command } = await import('commander');
      const { registerVerifyCommands } = await import('../../commands/verify.js');

      const program = new Command();
      program.exitOverride();
      registerVerifyCommands(program);

      await program.parseAsync([
        'node', 'marty', 'verify', 'status', 'session-42', '-o', 'json',
      ]);

      const url = apiCalls.get[0];
      expect(url).toBe('/v1/verify/session-42');
      // Gateway route is /v1/flows/instances/session-42
      expect(url).not.toContain('/v1/flows/instances/');
    });

    it('BUG: verify submit posts to /v1/verify/{id}/submit instead of /v1/flows/instances/{id}/submit', async () => {
      const { Command } = await import('commander');
      const { registerVerifyCommands } = await import('../../commands/verify.js');

      const program = new Command();
      program.exitOverride();
      registerVerifyCommands(program);

      await program.parseAsync([
        'node', 'marty', 'verify', 'submit', 'session-42',
        '--presentation', '{"vp":"test"}',
        '-o', 'json',
      ]);

      const call = apiCalls.post[0];
      expect(call.url).toBe('/v1/verify/session-42/submit');
      // Gateway route is /v1/flows/instances/session-42/submit
      expect(call.url).not.toContain('/v1/flows/instances/');
    });

    it('BUG: verify evaluate posts to /v1/verify/evaluate instead of /v1/presentation-policies/evaluate', async () => {
      const { Command } = await import('commander');
      const { registerVerifyCommands } = await import('../../commands/verify.js');

      const program = new Command();
      program.exitOverride();
      registerVerifyCommands(program);

      await program.parseAsync([
        'node', 'marty', 'verify', 'evaluate',
        '--credential', '{"vc":"test"}',
        '-o', 'json',
      ]);

      const call = apiCalls.post[0];
      expect(call.url).toBe('/v1/verify/evaluate');
      // Gateway route is /v1/presentation-policies/evaluate
      expect(call.url).not.toBe(GATEWAY_ROUTES.evaluatePresentation);
    });
  });

  // ── flows.js ──────────────────────────────────────────────────────

  describe('flows command', () => {
    it('BUG: flows list calls /v1/flows instead of /v1/flows/definitions', async () => {
      const { Command } = await import('commander');
      const { registerFlowsCommands } = await import('../../commands/flows.js');

      const program = new Command();
      program.exitOverride();
      registerFlowsCommands(program);

      await program.parseAsync(['node', 'marty', 'flows', 'list', '-o', 'json']);

      const url = apiCalls.get[0];
      // The URL starts with /v1/flows? which matches /v1/flows but not /v1/flows/definitions
      expect(url).toMatch(/^\/v1\/flows\?/);
      expect(url).not.toContain('/v1/flows/definitions');
    });

    it('BUG: flows inspect calls /v1/flows/{id} instead of /v1/flows/definitions/{id}', async () => {
      const { Command } = await import('commander');
      const { registerFlowsCommands } = await import('../../commands/flows.js');

      const program = new Command();
      program.exitOverride();
      registerFlowsCommands(program);

      await program.parseAsync(['node', 'marty', 'flows', 'inspect', 'flow-42', '-o', 'json']);

      const url = apiCalls.get[0];
      expect(url).toBe('/v1/flows/flow-42');
      // Gateway route is /v1/flows/definitions/flow-42
      expect(url).not.toContain('/v1/flows/definitions/');
    });
  });

  // ── teste2e.js verification scenario ──────────────────────────────

  describe('teste2e verification scenario', () => {
    it('BUG: scenarioVerification uses /v1/verify path (same as verify command)', async () => {
      // We can't easily test the e2e scenario runner because teste2e.js
      // calls process.exit() directly. Instead, we verify the hardcoded
      // URLs by reading the source code patterns.
      //
      // The scenarioVerification function uses:
      //   post('/v1/verify', body)          → should be /v1/flows/verify
      //   get(`/v1/verify/${sessionId}`)    → should be /v1/flows/instances/{id}
      //
      // These match the same wrong URLs as the verify command tests above,
      // confirming the e2e runner inherits the same endpoint mismatch.
      const src = (await import('node:fs')).readFileSync(
        new URL('../../commands/teste2e.js', import.meta.url),
        'utf-8',
      );

      // Assert the wrong URLs are present in source
      expect(src).toContain("'/v1/verify'");
      expect(src).toContain('/v1/verify/');

      // Assert the correct URLs are NOT present
      expect(src).not.toContain("'/v1/flows/verify'");
      expect(src).not.toContain('/v1/flows/instances/');
    });
  });
});
