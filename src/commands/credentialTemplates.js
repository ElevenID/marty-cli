/**
 * marty credential-templates — create, list, inspect, and publish credential templates.
 */

import { get, post } from '../lib/apiAdapter.js';
import { loadConfig } from '../lib/config.js';
import { getFormatter, withErrorHandler, fail, dryRun } from '../lib/output.js';

export function registerCredentialTemplatesCommands(program) {
  const ct = program
    .command('credential-templates')
    .alias('ct')
    .description('Manage credential templates');

  ct
    .command('list')
    .description('List credential templates')
    .option('-o, --output <format>', 'Output format (table|json)', 'table')
    .option('--limit <n>', 'Max results', '50')
    .action(withErrorHandler(async (opts) => {
      const config = loadConfig();
      const params = new URLSearchParams({ limit: opts.limit });
      if (config.organizationId) params.set('organization_id', config.organizationId);

      const data = await get(`/v1/credential-templates?${params}`);
      const list = Array.isArray(data) ? data : data?.templates || [];

      const fmt = getFormatter(opts.output);
      if (opts.output.startsWith('json')) { fmt.print(list); return; }

      const rows = list.map(t => ({
        id: t.id,
        name: t.name || '',
        type: t.credential_type || '',
        format: t.credential_payload_format || '',
        status: t.status || '',
      }));
      fmt.printList(rows, ['id', 'name', 'type', 'format', 'status']);
    }));

  ct
    .command('inspect <templateId>')
    .description('Show details of a credential template')
    .option('-o, --output <format>', 'Output format (table|json)', 'json')
    .action(withErrorHandler(async (templateId, opts) => {
      const data = await get(`/v1/credential-templates/${encodeURIComponent(templateId)}`);
      const fmt = getFormatter(opts.output);
      fmt.print(data);
    }));

  ct
    .command('create')
    .description('Create a new credential template')
    .requiredOption('--name <name>', 'Template name')
    .requiredOption('--credential-type <type>', 'Credential type identifier')
    .requiredOption('--compliance-profile-id <id>', 'Compliance profile ID')
    .requiredOption('--trust-profile-id <id>', 'Trust profile ID')
    .option('--format <fmt>', 'Credential payload format (SD_JWT_VC|VC_JWT|MDOC)', 'SD_JWT_VC')
    .option('--vct <uri>', 'Verifiable Credential Type URI')
    .option('--claims <json>', 'Claims definition as JSON array')
    .option('--key-access-mode <mode>', 'Key access mode (key_vault|local)', 'key_vault')
    .option('--issuer-algorithm <alg>', 'Signing algorithm (ES256|ES384|RS256)', 'ES256')
    .option('--issuer-did <did>', 'Issuer DID')
    .option('--privacy-posture <p>', 'Privacy posture (selective_disclosure|full_disclosure)', 'selective_disclosure')
    .option('-o, --output <format>', 'Output format (table|json)', 'json')
    .option('--dry-run', 'Show what would be done without executing')
    .action(withErrorHandler(async (opts) => {
      const config = loadConfig();
      if (!config.organizationId) fail('No active organization. Run: marty orgs switch <id>');

      const body = {
        organization_id: config.organizationId,
        name: opts.name,
        credential_type: opts.credentialType,
        compliance_profile_id: opts.complianceProfileId,
        trust_profile_id: opts.trustProfileId,
        credential_payload_format: opts.format,
        key_access_mode: opts.keyAccessMode,
        issuer_algorithm: opts.issuerAlgorithm,
        privacy_posture: opts.privacyPosture,
      };
      if (opts.vct) body.vct = opts.vct;
      if (opts.issuerDid) body.issuer_did = opts.issuerDid;
      if (opts.claims) {
        try { body.claims = JSON.parse(opts.claims); }
        catch { fail('--claims must be valid JSON'); }
      }

      if (dryRun(opts, 'POST /v1/credential-templates', body)) return;
      const result = await post('/v1/credential-templates', body);
      const fmt = getFormatter(opts.output);
      fmt.print(result);
    }));

  ct
    .command('publish <templateId>')
    .description('Publish a credential template (locks it for issuance)')
    .option('--force', 'Force publish even if validation warnings exist')
    .option('-o, --output <format>', 'Output format (table|json)', 'json')
    .option('--dry-run', 'Show what would be done without executing')
    .action(withErrorHandler(async (templateId, opts) => {
      const params = new URLSearchParams();
      if (opts.force) params.set('force', 'true');
      if (dryRun(opts, `POST /v1/credential-templates/${templateId}/publish`, {})) return;
      const result = await post(`/v1/credential-templates/${encodeURIComponent(templateId)}/publish?${params}`, {});
      const fmt = getFormatter(opts.output);
      fmt.print(result);
    }));
}
