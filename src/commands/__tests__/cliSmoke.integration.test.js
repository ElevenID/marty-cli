import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CLI_BIN = fileURLToPath(new URL('../../../bin/marty.js', import.meta.url));
const CLI_ROOT = resolve(dirname(CLI_BIN), '..');

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(Buffer.from(chunk));
  }

  if (!chunks.length) {
    return null;
  }

  const text = Buffer.concat(chunks).toString('utf8');

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function startGatewayStub() {
  const requests = [];

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const body = await readRequestBody(req);

    requests.push({
      method: req.method,
      pathname: url.pathname,
      searchParams: Object.fromEntries(url.searchParams),
      headers: req.headers,
      body,
    });

    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, {
        status: 'healthy',
        services: {
          gateway: 'healthy',
          database: 'ok',
        },
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/organizations') {
      sendJson(res, 200, {
        organizations: [
          { id: 'org-123', name: 'Acme Transit', role: 'admin' },
          { id: 'org-456', name: 'Beta Rail', role: 'developer' },
        ],
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/application-templates') {
      if (url.searchParams.get('organization_id') !== 'org-123') {
        sendJson(res, 400, {
          error: {
            code: 'BAD_ORG',
            message: 'Missing organization context',
            user_message: 'Missing organization context',
          },
        });
        return;
      }

      sendJson(res, 200, {
        templates: [
          {
            id: 'tpl-1',
            name: 'Employee Badge',
            credential_type: 'EmployeeCredential',
            status: 'active',
          },
        ],
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/v1/flows/verify') {
      sendJson(res, 200, {
        id: 'sess-1',
        request_uri: 'openid4vp://request/sess-1',
        status: 'pending',
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/v1/flows/instances/sess-1') {
      sendJson(res, 200, {
        id: 'sess-1',
        status: 'completed',
        presentation_policy_id: 'policy-1',
      });
      return;
    }

    sendJson(res, 404, {
      error: {
        code: 'NOT_FOUND',
        message: 'Route not found',
        user_message: 'Route not found',
      },
    });
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  return {
    baseUrl,
    requests,
    close: async () => {
      server.close();
      await once(server, 'close');
    },
  };
}

function parseJson(stdout) {
  return JSON.parse(stdout);
}

async function runCli(homeDir, baseUrl, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [CLI_BIN, ...args], {
      cwd: CLI_ROOT,
      env: {
        ...process.env,
        HOME: homeDir,
        USERPROFILE: homeDir,
        MARTY_API_URL: baseUrl,
        NO_COLOR: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', rejectPromise);
    child.on('close', (code) => {
      resolvePromise({
        code,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });
  });
}

describe('marty CLI binary smoke coverage', () => {
  let gateway;
  let homeDir;

  beforeEach(async () => {
    gateway = await startGatewayStub();
    homeDir = await mkdtemp(join(tmpdir(), 'marty-cli-smoke-'));
  });

  afterEach(async () => {
    if (gateway) {
      await gateway.close();
    }

    if (homeDir) {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it('runs the real auth, health, org, template, and verify workflow', async () => {
    const login = await runCli(homeDir, gateway.baseUrl, ['auth', 'login', '--api-key', 'smoke-key']);
    expect(login.code).toBe(0);
    expect(login.stdout).toContain('Logged in with API key.');

    const whoami = await runCli(homeDir, gateway.baseUrl, ['auth', 'whoami', '-o', 'json']);
    expect(whoami.code).toBe(0);
    expect(parseJson(whoami.stdout)).toMatchObject({ type: 'api_key' });

    const health = await runCli(homeDir, gateway.baseUrl, ['health', '-o', 'json']);
    expect(health.code).toBe(0);
    expect(parseJson(health.stdout)).toMatchObject({ status: 'healthy' });

    const orgs = await runCli(homeDir, gateway.baseUrl, ['orgs', 'list', '-o', 'json']);
    expect(orgs.code).toBe(0);
    expect(parseJson(orgs.stdout)).toHaveLength(2);

    const switchOrg = await runCli(homeDir, gateway.baseUrl, ['orgs', 'switch', 'org-123']);
    expect(switchOrg.code).toBe(0);
    expect(switchOrg.stdout).toContain('Active organization set to: org-123');

    const currentOrg = await runCli(homeDir, gateway.baseUrl, ['orgs', 'current']);
    expect(currentOrg.code).toBe(0);
    expect(currentOrg.stdout).toBe('org-123');

    const templates = await runCli(homeDir, gateway.baseUrl, ['templates', 'list', '-o', 'json']);
    expect(templates.code).toBe(0);
    expect(parseJson(templates.stdout)).toEqual([
      {
        id: 'tpl-1',
        name: 'Employee Badge',
        credential_type: 'EmployeeCredential',
        status: 'active',
      },
    ]);

    const verifyStart = await runCli(homeDir, gateway.baseUrl, ['verify', 'start', '--policy', 'policy-1', '-o', 'json']);
    expect(verifyStart.code).toBe(0);
    expect(parseJson(verifyStart.stdout)).toMatchObject({
      id: 'sess-1',
      status: 'pending',
    });

    const verifyStatus = await runCli(homeDir, gateway.baseUrl, ['verify', 'status', 'sess-1', '-o', 'json']);
    expect(verifyStatus.code).toBe(0);
    expect(parseJson(verifyStatus.stdout)).toMatchObject({
      id: 'sess-1',
      status: 'completed',
    });

    const authenticatedRequests = gateway.requests.filter((request) => request.pathname !== undefined);
    expect(authenticatedRequests).not.toHaveLength(0);
    for (const request of authenticatedRequests) {
      expect(request.headers['x-api-key']).toBe('smoke-key');
    }

    const templatesRequest = gateway.requests.find((request) => request.pathname === '/v1/application-templates');
    expect(templatesRequest.searchParams.organization_id).toBe('org-123');

    const verifyRequest = gateway.requests.find((request) => request.pathname === '/v1/flows/verify');
    expect(verifyRequest.body).toMatchObject({
      organization_id: 'org-123',
      presentation_policy_id: 'policy-1',
    });
  }, 20000);

  it('runs the real test e2e health scenario through the shipped binary', async () => {
    const login = await runCli(homeDir, gateway.baseUrl, ['auth', 'login', '--api-key', 'smoke-key']);
    expect(login.code).toBe(0);

    const smoke = await runCli(homeDir, gateway.baseUrl, ['test', 'e2e', '--scenario', 'health', '-o', 'json']);
    expect(smoke.code).toBe(0);

    expect(parseJson(smoke.stdout)).toMatchObject({
      summary: {
        total: 1,
        passed: 1,
        failed: 0,
      },
    });

    expect(gateway.requests.map((request) => request.pathname)).toContain('/health');
  }, 20000);
});