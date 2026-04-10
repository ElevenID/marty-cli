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
import { Command } from 'commander';
import { get } from '../lib/apiAdapter.js';
import { getFormatter, withErrorHandler, fail } from '../lib/output.js';
import { getConfigDir } from '../lib/config.js';

const LICENSE_FILE = join(getConfigDir(), 'license.key');

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
