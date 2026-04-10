/**
 * marty compliance — create, list, and inspect compliance profiles.
 */

import { get, post } from '../lib/apiAdapter.js';
import { loadConfig } from '../lib/config.js';
import { getFormatter, withErrorHandler, fail, dryRun } from '../lib/output.js';

export function registerComplianceCommands(program) {
  const cp = program
    .command('compliance')
    .description('Manage compliance profiles');

  cp
    .command('list')
    .description('List compliance profiles')
    .option('-o, --output <format>', 'Output format (table|json)', 'table')
    .option('--limit <n>', 'Max results', '50')
    .action(withErrorHandler(async (opts) => {
      const config = loadConfig();
      const params = new URLSearchParams({ limit: opts.limit });
      if (config.organizationId) params.set('organization_id', config.organizationId);

      const data = await get(`/v1/compliance-profiles?${params}`);
      const list = Array.isArray(data) ? data : data?.profiles || [];

      const fmt = getFormatter(opts.output);
      if (opts.output.startsWith('json')) { fmt.print(list); return; }

      const rows = list.map(p => ({
        id: p.id,
        name: p.name || '',
        code: p.compliance_code || '',
        format: p.credential_format || '',
      }));
      fmt.printList(rows, ['id', 'name', 'code', 'format']);
    }));

  cp
    .command('inspect <profileId>')
    .description('Show details of a compliance profile')
    .option('-o, --output <format>', 'Output format (table|json)', 'json')
    .action(withErrorHandler(async (profileId, opts) => {
      const data = await get(`/v1/compliance-profiles/${encodeURIComponent(profileId)}`);
      const fmt = getFormatter(opts.output);
      fmt.print(data);
    }));

  cp
    .command('create')
    .description('Create a new compliance profile')
    .requiredOption('--name <name>', 'Profile name')
    .requiredOption('--compliance-code <code>', 'Compliance code (e.g. eIDAS2, ICAO9303)')
    .option('--credential-format <fmt>', 'Credential format (SD_JWT_VC|VC_JWT|MDOC)', 'SD_JWT_VC')
    .option('--issuance-protocol <proto>', 'Issuance protocol (OID4VCI|DIRECT)', 'OID4VCI')
    .option('--presentation-protocol <proto>', 'Presentation protocol (OID4VP|DIRECT)', 'OID4VP')
    .option('--revocation-mechanism <mech>', 'Revocation mechanism')
    .option('-o, --output <format>', 'Output format (table|json)', 'json')
    .option('--dry-run', 'Show what would be done without executing')
    .action(withErrorHandler(async (opts) => {
      const config = loadConfig();
      if (!config.organizationId) fail('No active organization. Run: marty orgs switch <id>');

      const body = {
        organization_id: config.organizationId,
        name: opts.name,
        compliance_code: opts.complianceCode,
        credential_format: opts.credentialFormat,
        issuance_protocol: opts.issuanceProtocol,
      };
      if (opts.presentationProtocol) body.presentation_protocol = opts.presentationProtocol;
      if (opts.revocationMechanism) body.revocation_mechanism = opts.revocationMechanism;

      if (dryRun(opts, 'POST /v1/compliance-profiles', body)) return;
      const result = await post('/v1/compliance-profiles', body);
      const fmt = getFormatter(opts.output);
      fmt.print(result);
    }));
}
