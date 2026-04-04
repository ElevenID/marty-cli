/**
 * marty orgs — list and switch organizations.
 */

import { Command } from 'commander';
import { get } from '../lib/apiAdapter.js';
import { loadConfig, saveConfig } from '../lib/config.js';
import { getFormatter, withErrorHandler } from '../lib/output.js';

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
