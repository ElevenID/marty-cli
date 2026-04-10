/**
 * marty orgs — list, create, inspect and switch organizations.
 */

import { Command } from 'commander';
import { get, post } from '../lib/apiAdapter.js';
import { loadConfig, saveConfig } from '../lib/config.js';
import { getFormatter, withErrorHandler, fail, dryRun } from '../lib/output.js';

export function registerOrgsCommands(program) {
  const orgs = program.command('orgs').description('Manage organizations');

  orgs
    .command('list')
    .description('List organizations you belong to')
    .option('-o, --output <format>', 'Output format (table|json)', 'table')
    .action(withErrorHandler(async (opts) => {
      const data = await get('/v1/organizations');
      const list = Array.isArray(data) ? data : data?.organizations || [];
      const config = loadConfig();

      const fmt = getFormatter(opts.output);
      if (opts.output.startsWith('json')) {
        fmt.print(list);
        return;
      }

      const rows = list.map(org => ({
        id: org.id,
        name: org.name,
        role: org.role || '',
        active: org.id === config.organizationId ? '*' : '',
      }));
      fmt.printList(rows, ['active', 'id', 'name', 'role'], {
        headers: { active: ' ', id: 'ID', name: 'NAME', role: 'ROLE' },
      });
    }));

  orgs
    .command('create')
    .description('Create a new organization')
    .requiredOption('--name <name>', 'Organization name')
    .option('--display-name <name>', 'Display name')
    .option('--owner-id <id>', 'Owner user ID')
    .option('--visibility <v>', 'Visibility (PRIVATE|PUBLIC)', 'PRIVATE')
    .option('-o, --output <format>', 'Output format (table|json)', 'json')
    .option('--dry-run', 'Show what would be done without executing')
    .action(withErrorHandler(async (opts) => {
      const body = {
        name: opts.name,
        display_name: opts.displayName || opts.name,
        owner_id: opts.ownerId || undefined,
        visibility: opts.visibility,
      };
      if (dryRun(opts, 'POST /v1/organizations', body)) return;
      const result = await post('/v1/organizations', body);
      const fmt = getFormatter(opts.output);
      fmt.print(result);
    }));

  orgs
    .command('inspect <orgId>')
    .description('Show details of an organization')
    .option('-o, --output <format>', 'Output format (table|json)', 'json')
    .action(withErrorHandler(async (orgId, opts) => {
      const data = await get(`/v1/organizations/${encodeURIComponent(orgId)}`);
      const fmt = getFormatter(opts.output);
      fmt.print(data);
    }));

  orgs
    .command('switch <orgId>')
    .description('Set the active organization')
    .action((orgId) => {
      saveConfig({ organizationId: orgId });
      console.log(`Active organization set to: ${orgId}`);
    });

  orgs
    .command('current')
    .description('Show the active organization')
    .action(() => {
      const config = loadConfig();
      if (config.organizationId) {
        console.log(config.organizationId);
      } else {
        console.log('No active organization. Run: marty orgs switch <id>');
      }
    });
}
