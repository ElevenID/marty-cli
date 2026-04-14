/**
 * marty license — manage license activation and status.
 *
 * Commands:
 *   activate <token>  — store a license JWT locally
 *   status            — show current license info (decoded from local JWT)
 *   validate          — online validation against the issuer service
 *   deactivate        — remove the stored license
 */

import { readFileSync, writeFileSync, existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createPublicKey, verify } from 'node:crypto';
import { Command } from 'commander';
import { get } from '../lib/apiAdapter.js';
import { getFormatter, withErrorHandler, fail } from '../lib/output.js';
import { getConfigDir } from '../lib/config.js';

const LICENSE_FILE = join(getConfigDir(), 'license.key');
const DEFAULT_LICENSE_ISSUER = 'marty-license-issuer';
const KNOWN_PLAN_TIERS = new Set(['sandbox', 'program', 'institution', 'system']);
const PLACEHOLDER_PREFIXES = ['change-me', 'change_me', 'changeme', 'replace-me', 'replace_me'];
const VERIFIER_PRODUCT = 'verifier';

/**
 * Decode a JWT payload without verification (we don't have the public key client-side).
 * Only used for display — the server validates signatures.
 */
function decodeJwtPayload(token) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT format');
  const payload = Buffer.from(parts[1], 'base64url').toString('utf-8');
  return JSON.parse(payload);
}

function decodeJwtParts(token) {
  const parts = token.trim().split('.');
  if (parts.length !== 3) throw new Error('License token must be a JWT with three segments.');

  let header;
  let payload;
  let signature;
  try {
    header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf-8'));
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf-8'));
    signature = Buffer.from(parts[2], 'base64url');
  } catch {
    throw new Error('License token is not valid base64url JSON.');
  }

  if (!header || typeof header !== 'object' || Array.isArray(header)) {
    throw new Error('License token header must be a JSON object.');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('License token payload must be a JSON object.');
  }

  return {
    header,
    payload,
    signature,
    signingInput: Buffer.from(`${parts[0]}.${parts[1]}`, 'ascii'),
  };
}

function isPlaceholderValue(value) {
  const normalized = value.trim().toLowerCase();
  return PLACEHOLDER_PREFIXES.some(prefix => normalized.startsWith(prefix));
}

function normalizeString(value, label, { required = false } = {}) {
  if (value == null) {
    if (required) {
      throw new Error(`License claim ${label} is required.`);
    }
    return null;
  }
  if (typeof value !== 'string') {
    throw new Error(`License claim ${label} must be a string.`);
  }
  const normalized = value.trim();
  if (required && !normalized) {
    throw new Error(`License claim ${label} cannot be blank.`);
  }
  return normalized || null;
}

function normalizeInteger(value, label, { required = false, defaultValue = 0 } = {}) {
  if (value == null) {
    if (required) {
      throw new Error(`License claim ${label} is required.`);
    }
    return defaultValue;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || Number.isNaN(value)) {
    throw new Error(`License claim ${label} must be an integer.`);
  }
  return Math.trunc(value);
}

function normalizeStringList(value, label) {
  if (value == null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`License claim ${label} must be a list of strings.`);
  }

  return value.map((item) => {
    if (typeof item !== 'string') {
      throw new Error(`License claim ${label} must contain only strings.`);
    }
    return item.trim();
  }).filter(Boolean);
}

function normalizePlanTier(value, label) {
  if (value == null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new Error(`${label} must be a string.`);
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (!KNOWN_PLAN_TIERS.has(normalized)) {
    throw new Error(`${label} ${JSON.stringify(value)} is unsupported; expected one of ${Array.from(KNOWN_PLAN_TIERS).sort().join(', ')}.`);
  }
  return normalized;
}

function csvValues(value) {
  if (value == null || !String(value).trim()) {
    return [];
  }
  return String(value).split(',').map(item => item.trim()).filter(Boolean);
}

function normalizeClaims(payload) {
  const claims = {
    iss: normalizeString(payload.iss, 'iss', { required: true }),
    sub: normalizeString(payload.sub, 'sub', { required: true }),
    iat: normalizeInteger(payload.iat, 'iat', { required: true }),
    exp: normalizeInteger(payload.exp, 'exp', { required: true }),
    nbf: normalizeInteger(payload.nbf, 'nbf', { required: false, defaultValue: null }),
    jti: normalizeString(payload.jti, 'jti', { required: false }),
    org_name: normalizeString(payload.org_name, 'org_name', { required: false }),
    plan_tier: normalizePlanTier(payload.plan_tier, 'License claim plan_tier'),
    features: normalizeStringList(payload.features, 'features'),
    entitled_products: normalizeStringList(payload.entitled_products, 'entitled_products'),
  };

  if (!claims.features.length && !claims.entitled_products.length && claims.plan_tier == null) {
    throw new Error('License must include features, entitled products, or a plan tier.');
  }

  return claims;
}

function hasProduct(claims, product) {
  if (!claims.entitled_products.length) {
    return product === VERIFIER_PRODUCT;
  }
  if (claims.entitled_products.includes('*')) {
    return true;
  }
  return claims.entitled_products.includes(product);
}

function loadPublicKey(publicKeyPem) {
  let publicKey;
  try {
    publicKey = createPublicKey(publicKeyPem);
  } catch {
    throw new Error('License public key is not a valid PEM-encoded public key.');
  }

  if (publicKey.asymmetricKeyType !== 'ed25519') {
    throw new Error('License public key must be an Ed25519 public key.');
  }
  return publicKey;
}

function loadEnvFile(filePath) {
  if (!filePath || !existsSync(filePath)) {
    return {};
  }

  const values = {};
  for (const line of readFileSync(filePath, 'utf-8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const separator = trimmed.indexOf('=');
    if (separator === -1) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    values[key] = value;
  }
  return values;
}

function readTextFile(pathValue, label) {
  try {
    const value = readFileSync(pathValue, 'utf-8').trim();
    if (!value) {
      throw new Error(`${label} is empty.`);
    }
    return value;
  } catch (error) {
    if (error instanceof Error && error.message === `${label} is empty.`) {
      throw error;
    }
    throw new Error(`${label} could not be read from ${pathValue}.`);
  }
}

async function readTextFromStdin(label) {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const value = Buffer.concat(chunks).toString('utf-8').trim();
  if (!value) {
    throw new Error(`${label} was not provided on stdin.`);
  }
  return value;
}

function validateSelfHostLicense(token, publicKeyPem, envValues) {
  if (isPlaceholderValue(token)) {
    throw new Error('License token still uses a shipped placeholder value.');
  }
  if (isPlaceholderValue(publicKeyPem)) {
    throw new Error('License public key still uses a shipped placeholder value.');
  }

  const { header, payload, signature, signingInput } = decodeJwtParts(token);
  if (header.alg !== 'EdDSA') {
    throw new Error(`License token must use EdDSA; received ${JSON.stringify(header.alg)}.`);
  }

  const publicKey = loadPublicKey(publicKeyPem);
  if (!verify(null, signingInput, publicKey, signature)) {
    throw new Error('License signature is invalid.');
  }

  const claims = normalizeClaims(payload);
  const requiredIssuer = String(envValues.MARTY_LICENSE_REQUIRED_ISSUER || DEFAULT_LICENSE_ISSUER).trim() || DEFAULT_LICENSE_ISSUER;
  const requiredPlanTier = normalizePlanTier(envValues.MARTY_LICENSE_REQUIRED_PLAN_TIER || null, 'Required plan tier');
  const requiredProducts = csvValues(envValues.MARTY_LICENSE_REQUIRED_PRODUCTS || null);
  const now = Math.floor(Date.now() / 1000);

  if (claims.iss !== requiredIssuer) {
    throw new Error(`License issuer ${JSON.stringify(claims.iss)} does not match required issuer ${JSON.stringify(requiredIssuer)}.`);
  }
  if (claims.nbf != null && now < claims.nbf) {
    throw new Error('License is not active yet.');
  }
  if (now >= claims.exp) {
    throw new Error(`License expired at ${new Date(claims.exp * 1000).toISOString()}.`);
  }
  if (requiredPlanTier && claims.plan_tier !== requiredPlanTier) {
    throw new Error(`License plan tier ${JSON.stringify(claims.plan_tier || 'none')} does not satisfy required tier ${JSON.stringify(requiredPlanTier)}.`);
  }

  const missingProducts = requiredProducts.filter(product => !hasProduct(claims, product));
  if (missingProducts.length) {
    throw new Error(`License is missing required entitled products: ${missingProducts.sort().join(', ')}.`);
  }

  return claims;
}

function readLicense() {
  if (!existsSync(LICENSE_FILE)) return null;
  return readFileSync(LICENSE_FILE, 'utf-8').trim();
}

function writeLicense(token) {
  const dir = getConfigDir();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(LICENSE_FILE, token + '\n', { mode: 0o600 });
}

function removeLicense() {
  if (existsSync(LICENSE_FILE)) unlinkSync(LICENSE_FILE);
}

function formatDate(epoch) {
  if (!epoch) return 'N/A';
  return new Date(epoch * 1000).toISOString().replace('T', ' ').replace(/\.\d+Z/, ' UTC');
}

function daysUntil(epoch) {
  if (!epoch) return 'N/A';
  const now = Date.now() / 1000;
  const days = Math.floor((epoch - now) / 86400);
  if (days < 0) return `expired ${Math.abs(days)}d ago`;
  if (days === 0) return 'expires today';
  return `${days}d remaining`;
}

function ensureSingleSource(filePath, useStdin, label) {
  const sourceCount = (filePath ? 1 : 0) + (useStdin ? 1 : 0);
  if (sourceCount !== 1) {
    throw new Error(`${label} requires exactly one source: either the file option or the stdin option.`);
  }
}

export function registerLicenseCommands(program) {
  const license = program
    .command('license')
    .description('Manage license activation and status');

  // --- activate ---
  license
    .command('activate <token>')
    .description('Store a license JWT in ~/.marty/license.key')
    .action(withErrorHandler(async (token) => {
      // Basic sanity check — must look like a JWT
      if (token.split('.').length !== 3) {
        fail('Invalid license token — expected a JWT (three dot-separated segments).');
        return;
      }

      // Decode to show what was activated
      const claims = decodeJwtPayload(token);
      writeLicense(token);

      console.log('License activated.');
      console.log(`  Organization: ${claims.org_name || claims.sub}`);
      console.log(`  Plan:         ${claims.plan_tier || 'unknown'}`);
      console.log(`  Expires:      ${formatDate(claims.exp)}`);
    }));

  // --- status ---
  license
    .command('status')
    .description('Show current license info')
    .option('-o, --output <format>', 'Output format (table|json)', 'table')
    .action(withErrorHandler(async (opts) => {
      const token = readLicense();
      if (!token) {
        fail('No license activated. Run: marty license activate <token>');
        return;
      }

      const claims = decodeJwtPayload(token);
      const info = {
        license_id: claims.jti || 'N/A',
        organization: claims.org_name || claims.sub,
        plan_tier: claims.plan_tier || 'unknown',
        products: (claims.entitled_products || []).join(', '),
        features: (claims.features || []).join(', '),
        registry_access: claims.registry_access ? 'yes' : 'no',
        api_calls_limit: claims.api_calls_limit === 0 ? 'unlimited' : String(claims.api_calls_limit || 'N/A'),
        issued: formatDate(claims.iat),
        expires: formatDate(claims.exp),
        expiry_status: daysUntil(claims.exp),
        deployment_mode: claims.deployment_mode || 'N/A',
      };

      const fmt = getFormatter(opts.output);
      fmt.print(info);
    }));

  // --- validate ---
  license
    .command('validate')
    .description('Validate the license online against the issuer service')
    .option('-o, --output <format>', 'Output format (table|json)', 'table')
    .action(withErrorHandler(async (opts) => {
      const token = readLicense();
      if (!token) {
        fail('No license activated. Run: marty license activate <token>');
        return;
      }

      const claims = decodeJwtPayload(token);
      const jti = claims.jti;
      if (!jti) {
        fail('License has no JTI claim — cannot validate online.');
        return;
      }

      const result = await get(`/v1/licenses/validate/${jti}`);

      const fmt = getFormatter(opts.output);
      fmt.print({
        license_id: jti,
        status: result.status || 'unknown',
        valid: result.valid ? 'yes' : 'no',
        ...(result.message ? { message: result.message } : {}),
      });
    }));

  // --- install-selfhost ---
  license
    .command('install-selfhost')
    .description('Validate and install a self-host production license into SELFHOST_SECRET_DIR')
    .option('--env-file <path>', 'Path to the self-host env file', join(process.cwd(), '.env.selfhost.production.local'))
    .option('--secret-dir <path>', 'Override SELFHOST_SECRET_DIR from the env file')
    .option('--token-file <path>', 'Read the license JWT from a file')
    .option('--token-stdin', 'Read the license JWT from stdin without echoing it')
    .option('--public-key-file <path>', 'Read the issuer Ed25519 PEM public key from a file')
    .option('--public-key-stdin', 'Read the issuer Ed25519 PEM public key from stdin')
    .action(withErrorHandler(async (opts) => {
      ensureSingleSource(opts.tokenFile, opts.tokenStdin, 'License token');
      ensureSingleSource(opts.publicKeyFile, opts.publicKeyStdin, 'License public key');
      if (opts.tokenStdin && opts.publicKeyStdin) {
        throw new Error('License token and public key cannot both come from stdin in the same invocation.');
      }

      const envValues = loadEnvFile(opts.envFile);
      const secretDir = String(opts.secretDir || envValues.SELFHOST_SECRET_DIR || '').trim();
      if (!secretDir) {
        throw new Error('SELFHOST_SECRET_DIR is required via --secret-dir or the env file.');
      }

      const licenseToken = opts.tokenStdin
        ? await readTextFromStdin('License token')
        : readTextFile(opts.tokenFile, 'License token file');
      const publicKeyPem = opts.publicKeyStdin
        ? await readTextFromStdin('License public key')
        : readTextFile(opts.publicKeyFile, 'License public key file');

      const claims = validateSelfHostLicense(licenseToken, publicKeyPem, envValues);

      mkdirSync(secretDir, { recursive: true, mode: 0o700 });
      writeFileSync(join(secretDir, 'license_key'), `${licenseToken}\n`, { mode: 0o600 });
      writeFileSync(join(secretDir, 'license_public_key'), `${publicKeyPem}\n`, { mode: 0o600 });

      console.log('Self-host license installed.');
      console.log(`  Organization: ${claims.org_name || claims.sub}`);
      console.log(`  Plan:         ${claims.plan_tier || 'unknown'}`);
      console.log(`  Expires:      ${formatDate(claims.exp)}`);
    }));

  // --- deactivate ---
  license
    .command('deactivate')
    .description('Remove the stored license')
    .action(withErrorHandler(async () => {
      const token = readLicense();
      if (!token) {
        console.log('No license currently activated.');
        return;
      }

      removeLicense();
      console.log('License deactivated and removed from ~/.marty/license.key');
    }));
}
