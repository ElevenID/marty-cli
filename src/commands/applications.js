/**
 * marty applications — list, inspect, apply for credentials.
 *
 * Uses the same API endpoints as the headless applicationFormUseCases
 * layer, but calls them directly to avoid Node.js ESM resolution
 * issues with Vite-style extensionless imports in the UI source.
 */

import { get, post, patch, del } from '../lib/apiAdapter.js';
import { loadConfig } from '../lib/config.js';
import { getFormatter, withErrorHandler, fail, dryRun } from '../lib/output.js';
import { ask, select, isInteractive } from '../lib/prompt.js';

// ── thin wrappers matching applicantApi.jsx signatures ──────────────

function getApplicant(id) { return get(`/v1/applicants/profiles/${encodeURIComponent(id)}`); }
function getApplicantByUser(userId) {
  return get(`/v1/applicants/by-user/${encodeURIComponent(userId)}`).catch(e => {
    if (e.status === 404) return null;
    throw e;
  });
}
function createApplicant(data) { return post('/v1/applicants', data); }
function createApplication(data) { return post('/v1/applicants/applications', data); }
function autoIssueApplication(id) { return post(`/v1/applicants/applications/${encodeURIComponent(id)}/auto-issue`); }
function getCredentialTemplate(id) { return get(`/v1/application-templates/${encodeURIComponent(id)}`); }

async function resolveApplicantId(user) {
  if (user.applicant_id) {
    try {
      const applicant = await getApplicant(user.applicant_id);
      if (applicant?.id) return applicant.id;
    } catch { /* fall through */ }
  }
  if (!user.user_id) return null;
  const applicant = await getApplicantByUser(user.user_id);
  return applicant?.id || null;
}

async function listMyApplications(params = {}) {
  const qs = new URLSearchParams();
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.status) qs.set('status', params.status);
  const me = await get('/v1/auth/me');
  if (!me?.user_id) return { applications: [] };
  const applicant = await getApplicantByUser(me.user_id);
  if (!applicant?.id) return { applications: [] };
  const apps = await get(`/v1/applicants/${encodeURIComponent(applicant.id)}/applications?${qs}`);
  return { applications: Array.isArray(apps) ? apps : apps?.applications || [] };
}

/**
 * Auto-apply flow — mirrors autoApplyForCredential from applicationFormUseCases.js
 * without importing it (avoids Vite-only extensionless imports).
 */
async function autoApply({ organizationId, user, credentialConfig, credentialConfigId }) {
  let applicantId = await resolveApplicantId(user);
  if (!applicantId) {
    const created = await createApplicant({
      organization_id: organizationId,
      user_id: user.user_id,
      given_name: user.given_name || '',
      family_name: user.family_name || '',
      email: user.email,
    });
    applicantId = created?.id || null;
  }
  if (!applicantId) throw new Error('Unable to resolve applicant profile');

  // Deduplicate — check for existing active application
  const configId = credentialConfig?.id || credentialConfigId;
  try {
    const { applications = [] } = await listMyApplications({ limit: 100 });
    const existing = applications.find(
      a => a.credential_configuration_id === configId &&
        ['approved', 'credentialed', 'issued'].includes(a.status?.toLowerCase()),
    );
    if (existing) {
      return {
        applicationId: existing.id,
        offerData: {
          offer_url: existing.credential_offer_uri || null,
          credential_offer_uris: existing.credential_offer_uris || {},
          expires_at: existing.offer_expires_at || null,
        },
        existingApplication: true,
      };
    }
  } catch { /* proceed */ }

  const created = await createApplication({
    applicant_id: applicantId,
    credential_configuration_id: credentialConfig?.id || credentialConfigId,
    issuing_authority: 'ElevenID LLC',
  });
  const issued = await autoIssueApplication(created.id);
  return {
    applicationId: issued.id,
    offerData: {
      offer_url: issued.credential_offer_uri,
      credential_offer_uris: issued.credential_offer_uris || {},
      expires_at: issued.offer_expires_at,
    },
  };
}

export function registerApplicationsCommands(program) {
  const apps = program.command('applications').alias('apps').description('Manage credential applications');

  // ── list ─────────────────────────────────────────────────────────

  apps
    .command('list')
    .description('List applications')
    .option('-o, --output <format>', 'Output format (table|json)', 'table')
    .option('--org', 'List organization applications (instead of personal)')
    .option('--status <status>', 'Filter by status')
    .option('--limit <n>', 'Max results', '50')
    .action(withErrorHandler(async (opts) => {
      const config = loadConfig();
      let list;

      if (opts.org) {
        if (!config.organizationId) fail('No active organization. Run: marty orgs switch <id>');
        const qs = new URLSearchParams({ organization_id: config.organizationId, limit: opts.limit });
        if (opts.status) qs.set('status', opts.status);
        const data = await get(`/v1/applicants/org-applications?${qs}`);
        list = Array.isArray(data) ? data : data?.applications || [];
      } else {
        const data = await listMyApplications({ limit: opts.limit, status: opts.status });
        list = data.applications;
      }

      const fmt = getFormatter(opts.output);
      if (opts.output.startsWith('json')) { fmt.print(list); return; }

      const rows = list.map(a => ({
        id: a.id,
        credential: a.credential_configuration_id || a.credential_type || '',
        status: a.status || '',
        created: a.created_at ? new Date(a.created_at).toLocaleDateString() : '',
      }));
      fmt.printList(rows, ['id', 'credential', 'status', 'created']);
    }));

  // ── inspect ──────────────────────────────────────────────────────

  apps
    .command('inspect <applicationId>')
    .description('Show details of an application')
    .option('-o, --output <format>', 'Output format (table|json)', 'json')
    .action(withErrorHandler(async (applicationId, opts) => {
      const data = await get(`/v1/applicants/applications/${encodeURIComponent(applicationId)}`);
      const fmt = getFormatter(opts.output);
      fmt.print(data);
    }));

  // ── apply (auto-issue one-click flow) ────────────────────────────

  apps
    .command('apply [credentialConfigId]')
    .description('Apply for a credential (one-click auto-issue flow)')
    .option('-o, --output <format>', 'Output format (table|json)', 'table')
    .option('--dry-run', 'Show what would be done without executing')
    .action(withErrorHandler(async (credentialConfigId, opts) => {
      const config = loadConfig();
      if (!config.organizationId) fail('No active organization. Run: marty orgs switch <id>');

      // Interactive template selection if not provided
      if (!credentialConfigId) {
        if (!isInteractive()) fail('credentialConfigId argument is required in non-interactive mode');

        const qs = new URLSearchParams({ organization_id: config.organizationId });
        const data = await get(`/v1/application-templates?${qs}`);
        const templates = Array.isArray(data) ? data : data?.templates || [];
        if (!templates.length) fail('No credential templates found for this organization.');

        const chosen = await select('Select a credential template:', templates, {
          display: (t) => `${t.name || t.id} — ${t.description || t.credential_type || '(no description)'}`,
        });
        credentialConfigId = chosen.id;
      }

      // Get current user identity
      const me = await get('/v1/auth/me');
      if (!me?.user_id) fail('Not authenticated. Run: marty auth login');

      const user = {
        user_id: me.user_id,
        applicant_id: me.applicant_id || null,
        given_name: me.given_name || me.first_name || '',
        family_name: me.family_name || me.last_name || '',
        email: me.email || '',
      };

      // Load the credential template
      const template = await getCredentialTemplate(credentialConfigId);

      if (dryRun(opts, `POST /v1/applicants/applications (auto-apply)`, {
        organization_id: config.organizationId,
        credential_configuration_id: credentialConfigId,
        user_id: user.user_id,
      })) return;

      const result = await autoApply({
        organizationId: config.organizationId,
        user,
        credentialConfig: template,
        credentialConfigId,
      });

      const fmt = getFormatter(opts.output);
      if (opts.output.startsWith('json')) {
        fmt.print(result);
        return;
      }

      if (result.existingApplication) {
        console.log(`Existing application found: ${result.applicationId}`);
      } else {
        console.log(`Application created and issued: ${result.applicationId}`);
      }
      if (result.offerData?.offer_url) {
        console.log(`Credential offer: ${result.offerData.offer_url}`);
      }
      if (result.offerData?.expires_at) {
        console.log(`Expires: ${result.offerData.expires_at}`);
      }
    }));

  // ── approve ──────────────────────────────────────────────────────

  apps
    .command('approve <applicationId>')
    .description('Approve a pending application')
    .option('--notes <notes>', 'Reviewer notes')
    .option('--dry-run', 'Show what would be done without executing')
    .action(withErrorHandler(async (applicationId, opts) => {
      const body = {};
      if (opts.notes) body.notes = opts.notes;
      if (dryRun(opts, `POST /v1/applicants/applications/${applicationId}/approve`, body)) return;
      await post(`/v1/applicants/applications/${encodeURIComponent(applicationId)}/approve`, body);
      console.log(`Application ${applicationId} approved.`);
    }));

  // ── reject ───────────────────────────────────────────────────────

  apps
    .command('reject <applicationId>')
    .description('Reject a pending application')
    .option('--reason <reason>', 'Rejection reason')
    .option('--dry-run', 'Show what would be done without executing')
    .action(withErrorHandler(async (applicationId, opts) => {
      const body = {};
      if (opts.reason) body.reason = opts.reason;
      if (dryRun(opts, `POST /v1/applicants/applications/${applicationId}/reject`, body)) return;
      await post(`/v1/applicants/applications/${encodeURIComponent(applicationId)}/reject`, body);
      console.log(`Application ${applicationId} rejected.`);
    }));

  // ── issue ────────────────────────────────────────────────────────

  apps
    .command('issue <applicationId>')
    .description('Issue a credential for an approved application')
    .option('-o, --output <format>', 'Output format (table|json)', 'table')
    .option('--dry-run', 'Show what would be done without executing')
    .action(withErrorHandler(async (applicationId, opts) => {
      if (dryRun(opts, `POST /v1/applicants/applications/${applicationId}/issue`)) return;
      const result = await post(`/v1/applicants/applications/${encodeURIComponent(applicationId)}/issue`);
      const fmt = getFormatter(opts.output);
      if (opts.output.startsWith('json')) { fmt.print(result); return; }

      console.log(`Credential issued for application ${applicationId}.`);
      if (result?.credential_offer_uri) {
        console.log(`Offer URI: ${result.credential_offer_uri}`);
      }
    }));
}
