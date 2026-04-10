/**
 * marty verify — start verification sessions, submit presentations, inspect results.
 */

import { get, post } from '../lib/apiAdapter.js';
import { loadConfig } from '../lib/config.js';
import { getFormatter, withErrorHandler, fail, dryRun } from '../lib/output.js';
import { ask, select, isInteractive } from '../lib/prompt.js';

export function registerVerifyCommands(program) {
  const verify = program.command('verify').description('Verification operations');

  // ── start ────────────────────────────────────────────────────────

  verify
    .command('start')
    .description('Start a new verification session')
    .option('--policy <policyId>', 'Presentation policy ID')
    .option('--trust-profile <id>', 'Trust profile ID')
    .option('-o, --output <format>', 'Output format (table|json)', 'table')
    .option('--dry-run', 'Show what would be done without executing')
    .action(withErrorHandler(async (opts) => {
      const config = loadConfig();
      let policyId = opts.policy;

      // Interactive policy selection if not provided
      if (!policyId) {
        if (!isInteractive()) fail('--policy is required in non-interactive mode');
        if (!config.organizationId) fail('No active organization. Run: marty orgs switch <id>');

        const qs = new URLSearchParams({ organization_id: config.organizationId });
        const data = await get(`/v1/presentation-policies?${qs}`);
        const policies = Array.isArray(data) ? data : data?.policies || [];
        if (!policies.length) fail('No presentation policies found. Create one first.');

        const chosen = await select('Select a presentation policy:', policies, {
          display: (p) => `${p.name || p.id} — ${p.description || '(no description)'}`,
        });
        policyId = chosen.id;
      }

      const body = { presentation_policy_id: policyId };
      if (opts.trustProfile) body.trust_profile_id = opts.trustProfile;
      if (config.organizationId) body.organization_id = config.organizationId;

      if (dryRun(opts, 'POST /v1/flows/verify', body)) return;
      const session = await post('/v1/flows/verify', body);
      const fmt = getFormatter(opts.output);
      if (opts.output.startsWith('json')) { fmt.print(session); return; }

      console.log(`Session: ${session.id || session.session_id}`);
      if (session.request_uri) console.log(`Request URI: ${session.request_uri}`);
      if (session.status) console.log(`Status: ${session.status}`);
    }));

  // ── status ───────────────────────────────────────────────────────

  verify
    .command('status <sessionId>')
    .description('Check verification session status')
    .option('-o, --output <format>', 'Output format (table|json)', 'json')
    .action(withErrorHandler(async (sessionId, opts) => {
      const data = await get(`/v1/flows/instances/${encodeURIComponent(sessionId)}`);
      const fmt = getFormatter(opts.output);
      fmt.print(data);
    }));

  // ── submit ───────────────────────────────────────────────────────

  verify
    .command('submit <sessionId>')
    .description('Submit a verifiable presentation to a session')
    .requiredOption('--presentation <json>', 'VP as JSON string')
    .option('-o, --output <format>', 'Output format (table|json)', 'json')
    .option('--dry-run', 'Show what would be done without executing')
    .action(withErrorHandler(async (sessionId, opts) => {
      let presentation;
      try {
        presentation = JSON.parse(opts.presentation);
      } catch {
        fail('--presentation must be valid JSON');
      }
      if (dryRun(opts, `POST /v1/flows/instances/${sessionId}/submit`, presentation)) return;
      const result = await post(`/v1/flows/instances/${encodeURIComponent(sessionId)}/submit`, presentation);
      const fmt = getFormatter(opts.output);
      fmt.print(result);
    }));

  // ── evaluate ─────────────────────────────────────────────────────

  verify
    .command('evaluate')
    .description('Evaluate a credential or presentation without a session')
    .requiredOption('--credential <json>', 'Credential or VP as JSON string')
    .option('--policy <policyId>', 'Presentation policy ID')
    .option('--trust-profile <id>', 'Trust profile ID')
    .option('-o, --output <format>', 'Output format (table|json)', 'json')
    .option('--dry-run', 'Show what would be done without executing')
    .action(withErrorHandler(async (opts) => {
      let credential;
      try {
        credential = JSON.parse(opts.credential);
      } catch {
        credential = opts.credential;
      }
      const body = {
        vp_token: typeof credential === 'string' ? credential : JSON.stringify(credential),
      };
      if (opts.trustProfile) body.trust_profile_id = opts.trustProfile;

      const path = opts.policy
        ? `/v1/presentation-policies/${encodeURIComponent(opts.policy)}/evaluate`
        : '/v1/presentation-policies/evaluate';

      if (dryRun(opts, `POST ${path}`, body)) return;
      const result = await post(path, body);
      const fmt = getFormatter(opts.output);
      fmt.print(result);
    }));

  // ── sessions (list) ──────────────────────────────────────────────

  verify
    .command('sessions')
    .description('List verification sessions')
    .option('-o, --output <format>', 'Output format (table|json)', 'table')
    .option('--limit <n>', 'Max results', '50')
    .action(withErrorHandler(async (opts) => {
      const config = loadConfig();
      if (!config.organizationId) fail('No active organization. Run: marty orgs switch <id>');

      const qs = new URLSearchParams({
        organization_id: config.organizationId,
        limit: opts.limit,
      });
      const data = await get(`/v1/flows/instances?${qs}`);
      const list = Array.isArray(data) ? data : data?.sessions || [];

      const fmt = getFormatter(opts.output);
      if (opts.output.startsWith('json')) { fmt.print(list); return; }

      const rows = list.map(s => ({
        id: s.id || s.session_id,
        status: s.status || '',
        policy: s.presentation_policy_id || '',
        created: s.created_at ? new Date(s.created_at).toLocaleDateString() : '',
      }));
      fmt.printList(rows, ['id', 'status', 'policy', 'created']);
    }));

  // ── inspect ──────────────────────────────────────────────────────

  verify
    .command('inspect <sessionId>')
    .description('Get detailed inspection result for a session')
    .option('-o, --output <format>', 'Output format (table|json)', 'json')
    .action(withErrorHandler(async (sessionId, opts) => {
      const data = await get(`/v1/flows/instances/${encodeURIComponent(sessionId)}/result`);
      const fmt = getFormatter(opts.output);
      fmt.print(data);
    }));
}
