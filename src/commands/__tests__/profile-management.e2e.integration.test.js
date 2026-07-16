import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI_BIN = fileURLToPath(new URL('../../../bin/marty.js', import.meta.url));
const CLI_ROOT = resolve(dirname(CLI_BIN), '..');
const ORGANIZATION_ID = 'org-e2e-1';

function sendJson(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(value));
}

async function requestBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null;
}

function createGateway() {
  const applications = new Map();
  const locks = new Set();
  const requests = [];
  let nextId = 1;
  const orgBase = `/v1/organizations/${ORGANIZATION_ID}/applicants`;

  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const body = request.method === 'GET' || request.method === 'DELETE' ? null : await requestBody(request);
    requests.push({ method: request.method, path: url.pathname, query: url.search, body });

    if (request.method === 'GET' && url.pathname === '/v1/me/applications') {
      sendJson(response, 200, { items: [...applications.values()], total: applications.size, limit: 100, offset: 0 });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/v1/me/applications') {
      const keys = Object.keys(body || {}).sort();
      const expected = ['application_template_id', 'form_data', 'integration_context', 'organization_id'];
      if (JSON.stringify(keys) !== JSON.stringify(expected) || body.organization_id !== ORGANIZATION_ID) {
        sendJson(response, 422, { error: { user_message: 'Canonical application request required' } });
        return;
      }
      const application = {
        id: `application-${nextId++}`,
        organization_id: ORGANIZATION_ID,
        application_template_id: body.application_template_id,
        form_data: body.form_data,
        integration_context: body.integration_context,
        status: 'DRAFT',
        claim_state: 'NOT_READY',
      };
      applications.set(application.id, application);
      sendJson(response, 201, application);
      return;
    }

    const selfMatch = url.pathname.match(/^\/v1\/me\/applications\/([^/]+)(?:\/(submit|withdraw|claim))?$/);
    if (selfMatch) {
      const application = applications.get(selfMatch[1]);
      if (!application) { sendJson(response, 404, { detail: 'Application not found' }); return; }
      if (request.method === 'GET' && !selfMatch[2]) { sendJson(response, 200, application); return; }
      if (request.method === 'POST' && selfMatch[2] === 'submit') {
        Object.assign(application, { status: 'APPROVED', claim_state: 'OFFER_READY' });
        sendJson(response, 200, application);
        return;
      }
      if (request.method === 'POST' && selfMatch[2] === 'withdraw') {
        Object.assign(application, { status: 'WITHDRAWN', claim_state: 'NOT_READY' });
        sendJson(response, 200, application);
        return;
      }
      if (request.method === 'POST' && selfMatch[2] === 'claim') {
        sendJson(response, 200, {
          ...application,
          credential_offer_uri: `openid-credential-offer://application/${application.id}`,
        });
        return;
      }
    }

    if (request.method === 'GET' && url.pathname === orgBase) {
      sendJson(response, 200, { items: [...applications.values()], total: applications.size });
      return;
    }
    const orgMatch = url.pathname.match(new RegExp(`^${orgBase}/([^/]+)(?:/(lock|approve|reject|request-information|issue))?$`));
    if (orgMatch) {
      const application = applications.get(orgMatch[1]);
      if (!application) { sendJson(response, 404, { detail: 'Application not found' }); return; }
      const action = orgMatch[2];
      if (request.method === 'GET' && !action) { sendJson(response, 200, application); return; }
      if (request.method === 'POST' && action === 'lock') {
        locks.add(application.id);
        sendJson(response, 200, { status: 'ACTIVE', holder_user_id: 'reviewer-e2e' });
        return;
      }
      if (request.method === 'DELETE' && action === 'lock') {
        locks.delete(application.id);
        sendJson(response, 200, { released: true });
        return;
      }
      if (request.method === 'POST' && ['approve', 'reject', 'request-information'].includes(action)) {
        if (!locks.has(application.id)) { sendJson(response, 409, { detail: 'Reviewer lock required' }); return; }
        application.status = action === 'approve' ? 'APPROVED' : action === 'reject' ? 'REJECTED' : 'INFORMATION_REQUESTED';
        sendJson(response, 200, application);
        return;
      }
      if (request.method === 'POST' && action === 'issue') {
        Object.assign(application, { status: 'APPROVED', claim_state: 'OFFER_READY' });
        sendJson(response, 200, application);
        return;
      }
    }

    sendJson(response, 404, { detail: 'Route not found' });
  });

  return {
    applications,
    requests,
    async start() {
      server.listen(0, '127.0.0.1');
      await once(server, 'listening');
      return `http://127.0.0.1:${server.address().port}`;
    },
    async close() {
      if (!server.listening) return;
      server.close();
      await once(server, 'close');
    },
  };
}

async function runCli(apiUrl, args) {
  const home = join(tmpdir(), `marty-cli-e2e-${process.pid}`);
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [CLI_BIN, ...args], {
      cwd: CLI_ROOT,
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        MARTY_API_URL: apiUrl,
        MARTY_ORG_ID: ORGANIZATION_ID,
        NO_COLOR: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', rejectPromise);
    child.on('close', (code) => resolvePromise({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
}

describe('CLI canonical applicant lifecycle integration', () => {
  let gateway;
  let apiUrl;

  beforeEach(async () => {
    gateway = createGateway();
    apiUrl = await gateway.start();
  });

  afterEach(async () => {
    await gateway.close();
  });

  it('creates, submits, and claims through canonical self-service routes', async () => {
    const result = await runCli(apiUrl, [
      'applications', 'apply', 'application-template-1',
      '--form-data', '{"email":"holder@example.test"}',
      '--integration-context', '{"source":"spawned-e2e"}',
      '--output', 'json',
    ]);

    expect(result).toMatchObject({ code: 0, stderr: '' });
    const application = gateway.applications.get('application-1');
    expect(application).toMatchObject({
      application_template_id: 'application-template-1',
      form_data: { email: 'holder@example.test' },
      integration_context: { source: 'spawned-e2e' },
      status: 'APPROVED',
      claim_state: 'OFFER_READY',
    });
    expect(gateway.requests.map((entry) => `${entry.method} ${entry.path}`)).toEqual([
      'GET /v1/me/applications',
      'POST /v1/me/applications',
      'POST /v1/me/applications/application-1/submit',
      'POST /v1/me/applications/application-1/claim',
    ]);
    expect(JSON.stringify(gateway.requests)).not.toContain('/v1/applicants');
    expect(JSON.stringify(gateway.requests)).not.toContain('credential_configuration_id');
  });

  it('lists and inspects holder and reviewer resources separately', async () => {
    gateway.applications.set('application-1', {
      id: 'application-1',
      organization_id: ORGANIZATION_ID,
      application_template_id: 'template-1',
      status: 'SUBMITTED',
      claim_state: 'NOT_READY',
    });

    const personal = await runCli(apiUrl, ['applications', 'list', '--output', 'json']);
    const organization = await runCli(apiUrl, ['applications', 'list', '--org', '--output', 'json']);
    const detail = await runCli(apiUrl, ['applications', 'inspect', 'application-1', '--org', '--output', 'json']);

    expect(personal.code).toBe(0);
    expect(organization.code).toBe(0);
    expect(detail.code).toBe(0);
    expect(JSON.parse(personal.stdout)[0].id).toBe('application-1');
    expect(JSON.parse(detail.stdout).id).toBe('application-1');
  });

  it('wraps reviewer decisions in lock acquisition and release', async () => {
    gateway.applications.set('application-1', {
      id: 'application-1',
      organization_id: ORGANIZATION_ID,
      application_template_id: 'template-1',
      status: 'UNDER_REVIEW',
      claim_state: 'NOT_READY',
    });

    const result = await runCli(apiUrl, [
      'applications', 'approve', 'application-1', '--notes', 'verified',
    ]);

    expect(result).toMatchObject({ code: 0, stderr: '' });
    expect(gateway.requests.map((entry) => `${entry.method} ${entry.path}`)).toEqual([
      `POST /v1/organizations/${ORGANIZATION_ID}/applicants/application-1/lock`,
      `POST /v1/organizations/${ORGANIZATION_ID}/applicants/application-1/approve`,
      `DELETE /v1/organizations/${ORGANIZATION_ID}/applicants/application-1/lock`,
    ]);
  });

  it('rejects malformed form data before creating an application', async () => {
    const result = await runCli(apiUrl, [
      'applications', 'apply', 'application-template-1', '--form-data', '{bad json}',
    ]);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('--form-data must be a JSON object');
    expect(gateway.requests).toEqual([]);
  });
});
