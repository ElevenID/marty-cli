import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync, sign } from 'node:crypto';

const CLI_BIN = fileURLToPath(new URL('../../../bin/marty.js', import.meta.url));
const CLI_ROOT = resolve(dirname(CLI_BIN), '..');

const SUPPORTED_PLAN_TIERS = ['sandbox', 'program', 'institution', 'system'];

function makeSignedSelfHostLicense({ planTier, entitledProducts = ['ui-app'] }) {
  const now = Math.floor(Date.now() / 1000);
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');

  const claims = {
    iss: 'marty-license-issuer',
    sub: 'org-e2e-123',
    org_name: 'E2E Organization',
    iat: now,
    exp: now + 86400,
    jti: `lic-${planTier}-${now}`,
    plan_tier: planTier,
    entitled_products: entitledProducts,
    features: ['self-host'],
  };

  const header = Buffer.from(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signingInput = `${header}.${payload}`;
  const signature = sign(null, Buffer.from(signingInput, 'ascii'), privateKey).toString('base64url');

  return {
    token: `${signingInput}.${signature}`,
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString().trim(),
  };
}

async function runCli(homeDir, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [CLI_BIN, ...args], {
      cwd: CLI_ROOT,
      env: {
        ...process.env,
        HOME: homeDir,
        USERPROFILE: homeDir,
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

describe('marty CLI pricing scheme e2e (headless license gates)', () => {
  let homeDir;

  beforeEach(async () => {
    homeDir = await mkdtemp(join(tmpdir(), 'marty-cli-license-e2e-'));
  });

  afterEach(async () => {
    if (homeDir) {
      await rm(homeDir, { recursive: true, force: true });
    }
  });

  it('accepts all supported plan tiers when policy requirements match', async () => {
    for (const tier of SUPPORTED_PLAN_TIERS) {
      const scenarioDir = join(homeDir, tier);
      const secretDir = join(scenarioDir, 'secrets');
      const envPath = join(scenarioDir, '.env.selfhost.production.local');
      const tokenPath = join(scenarioDir, 'license.jwt');
      const pubKeyPath = join(scenarioDir, 'license-public-key.pem');

      await mkdir(scenarioDir, { recursive: true });

      await writeFile(envPath, [
        `SELFHOST_SECRET_DIR=${secretDir}`,
        'MARTY_LICENSE_REQUIRED_ISSUER=marty-license-issuer',
        `MARTY_LICENSE_REQUIRED_PLAN_TIER=${tier}`,
        'MARTY_LICENSE_REQUIRED_PRODUCTS=ui-app',
      ].join('\n'), 'utf8');

      const { token, publicKeyPem } = makeSignedSelfHostLicense({ planTier: tier });
      await writeFile(tokenPath, token, 'utf8');
      await writeFile(pubKeyPath, publicKeyPem, 'utf8');

      const result = await runCli(homeDir, [
        'license',
        'install-selfhost',
        '--env-file',
        envPath,
        '--token-file',
        tokenPath,
        '--public-key-file',
        pubKeyPath,
      ]);

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('Self-host license installed.');
      expect(result.stdout).toContain(`Plan:         ${tier}`);

      const installedToken = await readFile(join(secretDir, 'license_key'), 'utf8');

      expect(installedToken.trim()).toBe(token);
      await expect(readFile(join(secretDir, 'license_public_key'), 'utf8')).rejects.toThrow();
    }
  }, 30000);

  it('rejects install when required plan tier gate is not met', async () => {
    const scenarioDir = join(homeDir, 'mismatch');
    const secretDir = join(scenarioDir, 'secrets');
    const envPath = join(scenarioDir, '.env.selfhost.production.local');
    const tokenPath = join(scenarioDir, 'license.jwt');
    const pubKeyPath = join(scenarioDir, 'license-public-key.pem');

    await mkdir(scenarioDir, { recursive: true });

    await writeFile(envPath, [
      `SELFHOST_SECRET_DIR=${secretDir}`,
      'MARTY_LICENSE_REQUIRED_ISSUER=marty-license-issuer',
      'MARTY_LICENSE_REQUIRED_PLAN_TIER=system',
      'MARTY_LICENSE_REQUIRED_PRODUCTS=ui-app',
    ].join('\n'), 'utf8');

    const { token, publicKeyPem } = makeSignedSelfHostLicense({ planTier: 'program' });
    await writeFile(tokenPath, token, 'utf8');
    await writeFile(pubKeyPath, publicKeyPem, 'utf8');

    const result = await runCli(homeDir, [
      'license',
      'install-selfhost',
      '--env-file',
      envPath,
      '--token-file',
      tokenPath,
      '--public-key-file',
      pubKeyPath,
    ]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('does not satisfy required tier');
  });

  it('rejects unsupported commercial pricing aliases in license claims', async () => {
    const scenarioDir = join(homeDir, 'unsupported-tier');
    const secretDir = join(scenarioDir, 'secrets');
    const envPath = join(scenarioDir, '.env.selfhost.production.local');
    const tokenPath = join(scenarioDir, 'license.jwt');
    const pubKeyPath = join(scenarioDir, 'license-public-key.pem');

    await mkdir(scenarioDir, { recursive: true });

    await writeFile(envPath, [
      `SELFHOST_SECRET_DIR=${secretDir}`,
      'MARTY_LICENSE_REQUIRED_ISSUER=marty-license-issuer',
      'MARTY_LICENSE_REQUIRED_PRODUCTS=ui-app',
    ].join('\n'), 'utf8');

    const { token, publicKeyPem } = makeSignedSelfHostLicense({ planTier: 'professional' });
    await writeFile(tokenPath, token, 'utf8');
    await writeFile(pubKeyPath, publicKeyPem, 'utf8');

    const result = await runCli(homeDir, [
      'license',
      'install-selfhost',
      '--env-file',
      envPath,
      '--token-file',
      tokenPath,
      '--public-key-file',
      pubKeyPath,
    ]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('unsupported');
    expect(result.stderr).toContain('expected one of');
  });
});
