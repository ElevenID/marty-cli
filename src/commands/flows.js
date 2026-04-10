/**
 * marty flows — list, inspect, create, execute, and approve flows.
 */

import { get, post } from '../lib/apiAdapter.js';
import { loadConfig } from '../lib/config.js';
import { getFormatter, withErrorHandler, fail, dryRun } from '../lib/output.js';

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

      const data = await get(`/v1/flows/definitions?${params}`);
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
      const data = await get(`/v1/flows/definitions/${encodeURIComponent(flowId)}`);
      const fmt = getFormatter(opts.output);
      fmt.print(data);
    }));

  flows
    .command('create')
    .description('Create a new flow')
    .requiredOption('--name <name>', 'Flow name')
    .requiredOption('--flow-type <type>', 'Flow type (issuance|verification|presentation)')
    .requiredOption('--credential-template-id <id>', 'Credential template ID')
    .option('--approval-strategy <strategy>', 'Approval strategy (auto|manual)', 'auto')
    .option('--description <desc>', 'Flow description')
    .option('-o, --output <format>', 'Output format (table|json)', 'json')
    .option('--dry-run', 'Show what would be done without executing')
    .action(withErrorHandler(async (opts) => {
      const config = loadConfig();
      if (!config.organizationId) fail('No active organization. Run: marty orgs switch <id>');

      const body = {
        organization_id: config.organizationId,
        name: opts.name,
        flow_type: opts.flowType,
        credential_template_id: opts.credentialTemplateId,
        approval_strategy: opts.approvalStrategy,
      };
      if (opts.description) body.description = opts.description;

      if (dryRun(opts, 'POST /v1/flows/definitions', body)) return;
      const result = await post('/v1/flows/definitions', body);
      const fmt = getFormatter(opts.output);
      fmt.print(result);
    }));

  flows
    .command('execute <flowId>')
    .description('Start a new execution of a flow')
    .option('--context-data <json>', 'Execution context data as JSON')
    .option('-o, --output <format>', 'Output format (table|json)', 'json')
    .option('--dry-run', 'Show what would be done without executing')
    .action(withErrorHandler(async (flowId, opts) => {
      const body = { flow_definition_id: flowId };
      if (opts.contextData) {
        try { body.initial_context = JSON.parse(opts.contextData); }
        catch { fail('--context-data must be valid JSON'); }
      }

      if (dryRun(opts, 'POST /v1/flows/instances', body)) return;
      const result = await post('/v1/flows/instances', body);
      const fmt = getFormatter(opts.output);
      fmt.print(result);
    }));

  flows
    .command('approve <flowId> <executionId>')
    .description('Approve a flow execution')
    .option('--comment <text>', 'Approval comment')
    .option('-o, --output <format>', 'Output format (table|json)', 'json')
    .option('--dry-run', 'Show what would be done without executing')
    .action(withErrorHandler(async (flowId, executionId, opts) => {
      const body = {
        step_result: 'success',
        data: opts.comment ? { comment: opts.comment } : {},
      };

      if (dryRun(opts, `POST /v1/flows/instances/${executionId}/advance`, body)) return;
      const result = await post(
        `/v1/flows/instances/${encodeURIComponent(executionId)}/advance`,
        body
      );
      const fmt = getFormatter(opts.output);
      fmt.print(result);
    }));
}
