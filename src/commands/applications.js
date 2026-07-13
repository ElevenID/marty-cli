/**
 * Canonical MIP 0.3 applicant self-service and organization review commands.
 */

import { get, post, del } from '../lib/apiAdapter.js';
import { loadConfig } from '../lib/config.js';
import { getFormatter, withErrorHandler, fail, dryRun } from '../lib/output.js';
import { select, isInteractive } from '../lib/prompt.js';

const ME_APPLICATIONS = '/v1/me/applications';

function orgApplicantsPath(organizationId) {
  if (!organizationId) fail('No active organization. Run: marty orgs switch <id>');
  return `/v1/organizations/${encodeURIComponent(organizationId)}/applicants`;
}

function itemsFromPage(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  return [];
}

function parseObjectOption(value, optionName) {
  try {
    const parsed = JSON.parse(value || '{}');
    if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') throw new Error();
    return parsed;
  } catch {
    fail(`${optionName} must be a JSON object`);
  }
}

async function listMyApplications(params = {}) {
  const qs = new URLSearchParams();
  if (params.limit) qs.set('limit', String(params.limit));
  const suffix = qs.toString();
  const applications = itemsFromPage(await get(`${ME_APPLICATIONS}${suffix ? `?${suffix}` : ''}`));
  if (!params.status) return applications;
  const expected = String(params.status).toUpperCase();
  return applications.filter((application) => String(application.status || '').toUpperCase() === expected);
}

async function claimIfReady(application) {
  if (String(application?.claim_state || '').toUpperCase() !== 'OFFER_READY') return application;
  return post(`${ME_APPLICATIONS}/${encodeURIComponent(application.id)}/claim`, {});
}

async function applyForCredential({ organizationId, applicationTemplateId, formData, integrationContext }) {
  const applications = await listMyApplications({ limit: 100 });
  const existing = applications.find(
    (application) => application.application_template_id === applicationTemplateId &&
      !['rejected', 'withdrawn', 'expired'].includes(String(application.status || '').toLowerCase()),
  );
  if (existing) {
    return {
      applicationId: existing.id,
      application: await claimIfReady(existing),
      existingApplication: true,
    };
  }

  const created = await post(ME_APPLICATIONS, {
    organization_id: organizationId,
    application_template_id: applicationTemplateId,
    form_data: formData,
    integration_context: integrationContext,
  });
  const submitted = await post(`${ME_APPLICATIONS}/${encodeURIComponent(created.id)}/submit`, {});
  return {
    applicationId: created.id,
    application: await claimIfReady(submitted),
  };
}

async function withReviewerLock(organizationId, applicationId, action) {
  const base = `${orgApplicantsPath(organizationId)}/${encodeURIComponent(applicationId)}`;
  await post(`${base}/lock`, {});
  try {
    return await action(base);
  } finally {
    await del(`${base}/lock`);
  }
}

function offerUri(application) {
  return application?.credential_offer_uri || application?.offer_url || null;
}

export function registerApplicationsCommands(program) {
  const apps = program.command('applications').alias('apps').description('Manage credential applications');

  apps
    .command('list')
    .description('List applications')
    .option('-o, --output <format>', 'Output format (table|json)', 'table')
    .option('--org', 'List organization applications instead of personal applications')
    .option('--status <status>', 'Filter by status')
    .option('--limit <n>', 'Max results', '50')
    .action(withErrorHandler(async (opts) => {
      const config = loadConfig();
      let list;
      if (opts.org) {
        const qs = new URLSearchParams({ limit: opts.limit });
        if (opts.status) qs.set('status', opts.status);
        list = itemsFromPage(await get(`${orgApplicantsPath(config.organizationId)}?${qs}`));
      } else {
        list = await listMyApplications({ limit: opts.limit, status: opts.status });
      }

      const fmt = getFormatter(opts.output);
      if (opts.output.startsWith('json')) { fmt.print(list); return; }
      fmt.printList(list.map((application) => ({
        id: application.id,
        template: application.application_template_id || application.credential_template_id || '',
        status: application.status || '',
        claim: application.claim_state || '',
        created: application.created_at ? new Date(application.created_at).toLocaleDateString() : '',
      })), ['id', 'template', 'status', 'claim', 'created']);
    }));

  apps
    .command('inspect <applicationId>')
    .description('Show details of an application')
    .option('--org', 'Inspect as an organization reviewer')
    .option('-o, --output <format>', 'Output format (table|json)', 'json')
    .action(withErrorHandler(async (applicationId, opts) => {
      const config = loadConfig();
      const path = opts.org
        ? `${orgApplicantsPath(config.organizationId)}/${encodeURIComponent(applicationId)}`
        : `${ME_APPLICATIONS}/${encodeURIComponent(applicationId)}`;
      getFormatter(opts.output).print(await get(path));
    }));

  apps
    .command('apply [applicationTemplateId]')
    .description('Create and submit an application from an active Application Template')
    .option('--form-data <json>', 'Application form values as a JSON object', '{}')
    .option('--integration-context <json>', 'Integration context as a JSON object', '{}')
    .option('-o, --output <format>', 'Output format (table|json)', 'table')
    .option('--dry-run', 'Show what would be done without executing')
    .action(withErrorHandler(async (applicationTemplateId, opts) => {
      const config = loadConfig();
      if (!config.organizationId) fail('No active organization. Run: marty orgs switch <id>');

      if (!applicationTemplateId) {
        if (!isInteractive()) fail('applicationTemplateId argument is required in non-interactive mode');
        const data = await get(`/v1/application-templates?organization_id=${encodeURIComponent(config.organizationId)}`);
        const templates = itemsFromPage(data);
        if (!templates.length) fail('No active Application Templates found for this organization.');
        const chosen = await select('Select an Application Template:', templates, {
          display: (template) => `${template.name || template.id} - ${template.description || '(no description)'}`,
        });
        applicationTemplateId = chosen.id;
      }

      const request = {
        organization_id: config.organizationId,
        application_template_id: applicationTemplateId,
        form_data: parseObjectOption(opts.formData, '--form-data'),
        integration_context: parseObjectOption(opts.integrationContext, '--integration-context'),
      };
      if (dryRun(opts, `POST ${ME_APPLICATIONS}`, request)) return;

      const result = await applyForCredential({
        organizationId: config.organizationId,
        applicationTemplateId,
        formData: request.form_data,
        integrationContext: request.integration_context,
      });
      const fmt = getFormatter(opts.output);
      if (opts.output.startsWith('json')) { fmt.print(result); return; }
      console.log(result.existingApplication
        ? `Existing application found: ${result.applicationId}`
        : `Application submitted: ${result.applicationId}`);
      const uri = offerUri(result.application);
      if (uri) console.log(`Credential offer: ${uri}`);
      if (result.application?.claim_state === 'BLOCKED') {
        console.log(result.application.claim_blocker?.message || 'Credential issuance is waiting on the issuer.');
      }
    }));

  apps
    .command('submit <applicationId>')
    .description('Submit a draft application')
    .option('--dry-run', 'Show what would be done without executing')
    .action(withErrorHandler(async (applicationId, opts) => {
      const path = `${ME_APPLICATIONS}/${encodeURIComponent(applicationId)}/submit`;
      if (dryRun(opts, `POST ${path}`, {})) return;
      const result = await post(path, {});
      console.log(`Application ${applicationId} submitted with status ${result.status}.`);
    }));

  apps
    .command('withdraw <applicationId>')
    .description('Withdraw one of your applications')
    .option('--reason <reason>', 'Withdrawal reason')
    .option('--dry-run', 'Show what would be done without executing')
    .action(withErrorHandler(async (applicationId, opts) => {
      const path = `${ME_APPLICATIONS}/${encodeURIComponent(applicationId)}/withdraw`;
      const body = opts.reason ? { reason: opts.reason } : {};
      if (dryRun(opts, `POST ${path}`, body)) return;
      await post(path, body);
      console.log(`Application ${applicationId} withdrawn.`);
    }));

  apps
    .command('claim <applicationId>')
    .description('Create or refresh the offer for an offer-ready application')
    .option('-o, --output <format>', 'Output format (table|json)', 'table')
    .option('--dry-run', 'Show what would be done without executing')
    .action(withErrorHandler(async (applicationId, opts) => {
      const path = `${ME_APPLICATIONS}/${encodeURIComponent(applicationId)}/claim`;
      if (dryRun(opts, `POST ${path}`, {})) return;
      const result = await post(path, {});
      if (opts.output.startsWith('json')) { getFormatter(opts.output).print(result); return; }
      const uri = offerUri(result);
      console.log(uri ? `Credential offer: ${uri}` : `Application ${applicationId} is not offer-ready.`);
    }));

  apps
    .command('approve <applicationId>')
    .description('Approve a locked organization application')
    .option('--notes <notes>', 'Reviewer notes')
    .option('--dry-run', 'Show what would be done without executing')
    .action(withErrorHandler(async (applicationId, opts) => {
      const config = loadConfig();
      const body = opts.notes ? { notes: opts.notes } : {};
      const path = `${orgApplicantsPath(config.organizationId)}/${encodeURIComponent(applicationId)}/approve`;
      if (dryRun(opts, `POST ${path}`, body)) return;
      await withReviewerLock(config.organizationId, applicationId, (base) => post(`${base}/approve`, body));
      console.log(`Application ${applicationId} approved.`);
    }));

  apps
    .command('reject <applicationId>')
    .description('Reject a locked organization application')
    .requiredOption('--reason <reason>', 'Rejection reason')
    .option('--notes <notes>', 'Reviewer notes')
    .option('--dry-run', 'Show what would be done without executing')
    .action(withErrorHandler(async (applicationId, opts) => {
      const config = loadConfig();
      const body = { reason: opts.reason, ...(opts.notes ? { notes: opts.notes } : {}) };
      const path = `${orgApplicantsPath(config.organizationId)}/${encodeURIComponent(applicationId)}/reject`;
      if (dryRun(opts, `POST ${path}`, body)) return;
      await withReviewerLock(config.organizationId, applicationId, (base) => post(`${base}/reject`, body));
      console.log(`Application ${applicationId} rejected.`);
    }));

  apps
    .command('request-info <applicationId>')
    .description('Request additional information from an applicant')
    .requiredOption('--message <message>', 'Applicant-facing message')
    .option('--missing <items...>', 'Missing item identifiers')
    .option('--deadline <date>', 'Response deadline')
    .option('--dry-run', 'Show what would be done without executing')
    .action(withErrorHandler(async (applicationId, opts) => {
      const config = loadConfig();
      const body = {
        message: opts.message,
        missing_items: opts.missing || [],
        ...(opts.deadline ? { deadline: opts.deadline } : {}),
      };
      const path = `${orgApplicantsPath(config.organizationId)}/${encodeURIComponent(applicationId)}/request-information`;
      if (dryRun(opts, `POST ${path}`, body)) return;
      await withReviewerLock(config.organizationId, applicationId, (base) => post(`${base}/request-information`, body));
      console.log(`Information requested for application ${applicationId}.`);
    }));

  apps
    .command('issue <applicationId>')
    .description('Initiate issuance for an approved organization application')
    .option('-o, --output <format>', 'Output format (table|json)', 'table')
    .option('--dry-run', 'Show what would be done without executing')
    .action(withErrorHandler(async (applicationId, opts) => {
      const config = loadConfig();
      const path = `${orgApplicantsPath(config.organizationId)}/${encodeURIComponent(applicationId)}/issue`;
      if (dryRun(opts, `POST ${path}`, {})) return;
      const result = await post(path, {});
      if (opts.output.startsWith('json')) { getFormatter(opts.output).print(result); return; }
      console.log(`Credential issuance initiated for application ${applicationId}.`);
      const uri = offerUri(result);
      if (uri) console.log(`Offer URI: ${uri}`);
    }));
}
