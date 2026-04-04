/**
 * marty credentials — list, inspect, revoke credentials.
 */

import { get, post } from '../lib/apiAdapter.js';
import { loadConfig } from '../lib/config.js';
import { getFormatter, withErrorHandler, fail, dryRun } from '../lib/output.js';

export function registerCredentialsCommands(program) {
  const creds = program.command('credentials').alias('creds').description('Manage credentials');

  creds
    .command('list')
    .description('List issued credentials')
    .option('-o, --output <format>', 'Output format (table|json)', 'table')
    .option('--limit <n>', 'Max results', '50')
    .action(withErrorHandler(async (opts) => {
      const config = loadConfig();
      const params = new URLSearchParams({ limit: opts.limit });
      if (config.organizationId) params.set('organization_id', config.organizationId);

      const data = await get(`/v1/credentials?${params}`);
      const list = Array.isArray(data) ? data : data?.credentials || [];

      const fmt = getFormatter(opts.output);
      if (opts.output.startsWith('json')) {
        fmt.print(list);
        return;
      }

      const rows = list.map(c => ({
        id: c.id,
        type: c.credential_type || c.type || '',
        status: c.status || '',
        issued: c.issued_at ? new Date(c.issued_at).toLocaleDateString() : '',
        holder: c.holder_identifier || '',
      }));
      fmt.printList(rows, ['id', 'type', 'status', 'issued', 'holder']);
    }));

  creds
    .command('inspect <credentialId>')
    .description('Show details of a credential')
    .option('-o, --output <format>', 'Output format (table|json)', 'json')
    .action(withErrorHandler(async (credentialId, opts) => {
      const data = await get(`/v1/credentials/${encodeURIComponent(credentialId)}`);
      const fmt = getFormatter(opts.output);
      fmt.print(data);
    }));

  creds
    .command('revoke <credentialId>')
    .description('Revoke a credential')
    .option('--reason <reason>', 'Revocation reason')
    .option('--immediate', 'Revoke immediately (vs. end of period)')
    .option('--dry-run', 'Show what would be done without executing')
    .action(withErrorHandler(async (credentialId, opts) => {
      const body = { credential_id: credentialId };
      if (opts.reason) body.reason = opts.reason;
      if (opts.immediate) body.immediate = true;
      if (dryRun(opts, 'POST /v1/credentials/revoke', body)) return;
      const result = await post('/v1/credentials/revoke', body);
      console.log(`Credential ${credentialId} revoked.`);
    }));
}
