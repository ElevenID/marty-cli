/**
 * marty templates — list and inspect credential/application templates.
 */

import { get } from '../lib/apiAdapter.js';
import { loadConfig } from '../lib/config.js';
import { getFormatter, withErrorHandler, fail } from '../lib/output.js';

export function registerTemplatesCommands(program) {
  const tpl = program.command('templates').description('Manage credential templates');

  tpl
    .command('list')
    .description('List application templates')
    .option('-o, --output <format>', 'Output format (table|json)', 'table')
    .action(withErrorHandler(async (opts) => {
      const config = loadConfig();
      if (!config.organizationId) fail('No active organization. Run: marty orgs switch <id>');

      const data = await get(`/v1/application-templates?organization_id=${encodeURIComponent(config.organizationId)}`);
      const list = Array.isArray(data) ? data : data?.templates || [];

      const fmt = getFormatter(opts.output);
      if (opts.output.startsWith('json')) { fmt.print(list); return; }

      const rows = list.map(t => ({
        id: t.id,
        name: t.name || '',
        type: t.credential_type || t.type || '',
        status: t.status || '',
      }));
      fmt.printList(rows, ['id', 'name', 'type', 'status']);
    }));

  tpl
    .command('inspect <templateId>')
    .description('Show details of a template')
    .option('-o, --output <format>', 'Output format (table|json)', 'json')
    .action(withErrorHandler(async (templateId, opts) => {
      const data = await get(`/v1/application-templates/${encodeURIComponent(templateId)}`);
      const fmt = getFormatter(opts.output);
      fmt.print(data);
    }));
}
