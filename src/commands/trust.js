/**
 * marty trust — create, list, and inspect trust profiles.
 */

import { get, post } from '../lib/apiAdapter.js';
import { loadConfig } from '../lib/config.js';
import { getFormatter, withErrorHandler, fail, dryRun } from '../lib/output.js';

export function registerTrustCommands(program) {
  const tp = program
    .command('trust')
    .description('Manage trust profiles');

  tp
    .command('list')
    .description('List trust profiles')
    .option('-o, --output <format>', 'Output format (table|json)', 'table')
    .option('--limit <n>', 'Max results', '50')
    .action(withErrorHandler(async (opts) => {
      const config = loadConfig();
      const params = new URLSearchParams({ limit: opts.limit });
      if (config.organizationId) params.set('organization_id', config.organizationId);

      const data = await get(`/v1/trust-profiles?${params}`);
      const list = Array.isArray(data) ? data : data?.profiles || [];

      const fmt = getFormatter(opts.output);
      if (opts.output.startsWith('json')) { fmt.print(list); return; }

      const rows = list.map(p => ({
        id: p.id,
        name: p.name || '',
        type: p.profile_type || '',
      }));
      fmt.printList(rows, ['id', 'name', 'type']);
    }));

  tp
    .command('inspect <profileId>')
    .description('Show details of a trust profile')
    .option('-o, --output <format>', 'Output format (table|json)', 'json')
    .action(withErrorHandler(async (profileId, opts) => {
      const data = await get(`/v1/trust-profiles/${encodeURIComponent(profileId)}`);
      const fmt = getFormatter(opts.output);
      fmt.print(data);
    }));

  tp
    .command('create')
    .description('Create a new trust profile')
    .requiredOption('--name <name>', 'Profile name')
    .option('--profile-type <type>', 'Profile type (standard|high_assurance)', 'standard')
    .option('--allowed-algorithms <json>', 'Allowed algorithms as JSON array')
    .option('--supported-formats <json>', 'Supported credential formats as JSON array')
    .option('--key-storage <storage>', 'Key storage requirement (hsm|software)', 'software')
    .option('-o, --output <format>', 'Output format (table|json)', 'json')
    .option('--dry-run', 'Show what would be done without executing')
    .action(withErrorHandler(async (opts) => {
      const config = loadConfig();
      if (!config.organizationId) fail('No active organization. Run: marty orgs switch <id>');

      const body = {
        organization_id: config.organizationId,
        name: opts.name,
        profile_type: opts.profileType,
      };
      if (opts.keyStorage) body.key_storage = opts.keyStorage;
      if (opts.allowedAlgorithms) {
        try { body.allowed_algorithms = JSON.parse(opts.allowedAlgorithms); }
        catch { fail('--allowed-algorithms must be valid JSON'); }
      }
      if (opts.supportedFormats) {
        try { body.supported_formats = JSON.parse(opts.supportedFormats); }
        catch { fail('--supported-formats must be valid JSON'); }
      }

      if (dryRun(opts, 'POST /v1/trust-profiles', body)) return;
      const result = await post('/v1/trust-profiles', body);
      const fmt = getFormatter(opts.output);
      fmt.print(result);
    }));
}
