/**
 * marty flows — list and inspect flows.
 */

import { get } from '../lib/apiAdapter.js';
import { loadConfig } from '../lib/config.js';
import { getFormatter, withErrorHandler } from '../lib/output.js';

export function registerFlowsCommands(program) {
  const flows = program.command('flows').description('Manage flows');

  flows
    .command('list')
    .description('List configured flows')
    .option('-o, --output <format>', 'Output format (table|json)', 'table')
    .option('--limit <n>', 'Max results', '50')
    .action(withErrorHandler(async (opts) => {
      const config = loadConfig();
      const params = new URLSearchParams({ limit: opts.limit });
      if (config.organizationId) params.set('organization_id', config.organizationId);

      const data = await get(`/v1/flows?${params}`);
      const list = Array.isArray(data) ? data : data?.flows || [];

      const fmt = getFormatter(opts.output);
      if (opts.output.startsWith('json')) {
        fmt.print(list);
        return;
      }

      const rows = list.map(f => ({
        id: f.id,
        name: f.name || '',
        status: f.status || '',
        type: f.flow_type || f.type || '',
      }));
      fmt.printList(rows, ['id', 'name', 'type', 'status']);
    }));

  flows
    .command('inspect <flowId>')
    .description('Show details of a flow')
    .option('-o, --output <format>', 'Output format (table|json)', 'json')
    .action(withErrorHandler(async (flowId, opts) => {
      const data = await get(`/v1/flows/${encodeURIComponent(flowId)}`);
      const fmt = getFormatter(opts.output);
      fmt.print(data);
    }));
}
