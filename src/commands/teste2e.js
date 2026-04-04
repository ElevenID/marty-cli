/**
 * marty test:e2e — scripted end-to-end flows for CI.
 *
 * Runs a multi-step integration scenario:
 *   1. Health check
 *   2. Apply for a credential
 *   3. Issue the credential
 *   4. Start a verification session
 *   5. Report results
 *
 * Exits 0 on success, 1 on failure — suitable for CI pipelines.
 */

import { get, post } from '../lib/apiAdapter.js';
import { loadConfig } from '../lib/config.js';
import { isLoggedIn } from '../lib/auth.js';
import { fail, dryRun } from '../lib/output.js';

/** Simple step runner with status reporting. */
class TestRunner {
  constructor({ quiet = false, dryRunMode = false } = {}) {
    this.steps = [];
    this.quiet = quiet;
    this.dryRunMode = dryRunMode;
    this.startTime = null;
  }

  log(msg) {
    if (!this.quiet) console.log(msg);
  }

  async runStep(name, fn) {
    const t0 = Date.now();
    this.log(`  ▸ ${name}…`);
    try {
      const result = this.dryRunMode
        ? { _dryRun: true }
        : await fn();
      const elapsed = Date.now() - t0;
      this.steps.push({ name, status: 'pass', elapsed, result });
      this.log(`    ✓ ${name} (${elapsed}ms)`);
      return result;
    } catch (err) {
      const elapsed = Date.now() - t0;
      const message = err?.response?.error?.user_message || err?.message || String(err);
      this.steps.push({ name, status: 'fail', elapsed, error: message });
      this.log(`    ✗ ${name} — ${message} (${elapsed}ms)`);
      throw err;
    }
  }

  report(format) {
    const totalElapsed = Date.now() - this.startTime;
    const passed = this.steps.filter(s => s.status === 'pass').length;
    const failed = this.steps.filter(s => s.status === 'fail').length;
    const summary = { total: this.steps.length, passed, failed, elapsed: totalElapsed };

    if (format?.startsWith('json')) {
      console.log(JSON.stringify({ summary, steps: this.steps }, null, 2));
    } else {
      console.log('');
      console.log(`Results: ${passed} passed, ${failed} failed, ${this.steps.length} total (${totalElapsed}ms)`);
      if (failed > 0) {
        console.log('');
        for (const s of this.steps.filter(s => s.status === 'fail')) {
          console.log(`  FAIL: ${s.name} — ${s.error}`);
        }
      }
    }

    return failed === 0;
  }
}

// ── Built-in test scenarios ────────────────────────────────────────

async function scenarioHealthCheck(runner) {
  await runner.runStep('Health check', async () => {
    const data = await get('/health');
    if (data.status !== 'healthy' && data.status !== 'ok') {
      throw new Error(`Unexpected health status: ${data.status}`);
    }
    return data;
  });
}

async function scenarioIssuanceFlow(runner, credentialConfigId) {
  const config = loadConfig();

  // Get applicant (current user)
  const applicant = await runner.runStep('Resolve applicant', async () => {
    return await get('/v1/applicants/me');
  });

  const applicantId = applicant?.applicant_id || applicant?.id;

  // Create application
  const application = await runner.runStep('Create application', async () => {
    return await post('/v1/applicants/applications', {
      applicant_id: applicantId,
      credential_configuration_id: credentialConfigId,
      organization_id: config.organizationId,
    });
  });

  const applicationId = application?.application_id || application?.id;

  // Auto-issue (approve + issue in one step)
  const credential = await runner.runStep('Auto-issue credential', async () => {
    return await post(`/v1/applicants/applications/${encodeURIComponent(applicationId)}/auto-issue`);
  });

  return { applicantId, applicationId, credential };
}

async function scenarioVerification(runner, policyId) {
  const config = loadConfig();

  const session = await runner.runStep('Start verification session', async () => {
    const body = { presentation_policy_id: policyId };
    if (config.organizationId) body.organization_id = config.organizationId;
    return await post('/v1/verify', body);
  });

  const sessionId = session?.id || session?.session_id;

  await runner.runStep('Check session status', async () => {
    return await get(`/v1/verify/${encodeURIComponent(sessionId)}`);
  });

  return { sessionId, session };
}

async function scenarioWalletInterop(runner, credentialConfigId) {
  const config = loadConfig();

  // Step 1: Discover issuer metadata
  const metadata = await runner.runStep('Fetch issuer metadata', async () => {
    const orgId = config.organizationId;
    const data = await get(`/.well-known/openid-credential-issuer/org/${orgId}`);
    if (!data.credential_issuer) throw new Error('Missing credential_issuer in metadata');
    if (!data.credential_configurations_supported) throw new Error('Missing credential_configurations_supported');
    return {
      credential_issuer: data.credential_issuer,
      configurations: Object.keys(data.credential_configurations_supported),
      has_nonce_endpoint: !!data.nonce_endpoint,
    };
  });

  // Step 2: Create a credential offer
  const offer = await runner.runStep('Create credential offer', async () => {
    return await post('/v1/issuance', {
      organization_id: config.organizationId,
      credential_template_id: credentialConfigId,
      claims: {
        given_name: 'CLI-Interop',
        family_name: 'Test',
        date_of_birth: '1990-01-01',
      },
    });
  });

  // Step 3: Validate offer structure (OID4VCI §4.1)
  await runner.runStep('Validate offer structure', async () => {
    const offerUri = offer?.credential_offer_uri;
    if (!offerUri) throw new Error('No credential_offer_uri in issuance response');

    const url = new URL(offerUri.replace('openid-credential-offer://', 'https://placeholder/'));
    const offerParam = url.searchParams.get('credential_offer');
    const offerUriParam = url.searchParams.get('credential_offer_uri');

    if (!offerParam && !offerUriParam) {
      throw new Error('Offer URI missing credential_offer or credential_offer_uri parameter');
    }

    if (offerParam) {
      const parsed = JSON.parse(offerParam);
      if (!parsed.credential_issuer) throw new Error('Offer missing credential_issuer');
      if (!parsed.credential_configuration_ids?.length) {
        throw new Error('Offer missing credential_configuration_ids');
      }
      if (!parsed.grants) throw new Error('Offer missing grants');
      return { parsed, config_ids: parsed.credential_configuration_ids };
    }

    return { offer_uri: offerUriParam };
  });

  // Step 4: Validate nonce endpoint (OID4VCI §7)
  if (metadata?.has_nonce_endpoint) {
    await runner.runStep('Validate nonce endpoint', async () => {
      const data = await post('/v1/issuance/nonce', {});
      if (!data.c_nonce) throw new Error('Nonce response missing c_nonce');
      return { c_nonce_length: data.c_nonce.length };
    });
  }

  return { metadata, offer };
}

// ── Command registration ───────────────────────────────────────────

export function registerTestCommands(program) {
  const test = program.command('test').description('Test automation commands');

  test
    .command('e2e')
    .description('Run end-to-end integration scenario')
    .option('--credential-config <id>', 'Credential configuration ID for issuance flow')
    .option('--policy <id>', 'Presentation policy ID for verification flow')
    .option('--scenario <name>', 'Run a specific scenario: health, issuance, verification, wallet-interop, full', 'full')
    .option('-o, --output <format>', 'Output format (table|json)', 'table')
    .option('--dry-run', 'Show steps without executing API calls')
    .action(async (opts) => {
      const jsonOutput = opts.output?.startsWith('json');
      const runner = new TestRunner({ dryRunMode: opts.dryRun, quiet: jsonOutput });
      runner.startTime = Date.now();

      const scenario = opts.scenario;

      if (opts.dryRun) {
        runner.log('[dry-run] Would run scenario:', scenario);
      }

      runner.log(`Running e2e scenario: ${scenario}`);
      runner.log('');

      let success = true;

      try {
        // Pre-flight: auth check
        if (!opts.dryRun && !isLoggedIn()) {
          fail('Not authenticated. Run: marty auth login --api-key <key>');
        }

        // Health – always
        if (['health', 'full'].includes(scenario)) {
          await scenarioHealthCheck(runner);
        }

        // Issuance
        if (['issuance', 'full'].includes(scenario)) {
          if (!opts.credentialConfig) {
            fail('--credential-config is required for issuance scenario');
          }
          await scenarioIssuanceFlow(runner, opts.credentialConfig);
        }

        // Verification
        if (['verification', 'full'].includes(scenario)) {
          if (!opts.policy) {
            fail('--policy is required for verification scenario');
          }
          await scenarioVerification(runner, opts.policy);
        }

        // Wallet interop (OID4VCI v1 conformance)
        if (['wallet-interop', 'full'].includes(scenario)) {
          if (!opts.credentialConfig) {
            fail('--credential-config is required for wallet-interop scenario');
          }
          await scenarioWalletInterop(runner, opts.credentialConfig);
        }
      } catch {
        success = false;
      }

      const allPassed = runner.report(opts.output);
      process.exit(allPassed && success ? 0 : 1);
    });

  // Convenience alias: `marty test:health` just runs health scenario
  test
    .command('health')
    .description('Quick health-check test')
    .option('-o, --output <format>', 'Output format (table|json)', 'table')
    .action(async (opts) => {
      const runner = new TestRunner();
      runner.startTime = Date.now();

      console.log('Running health check test');
      console.log('');

      try {
        await scenarioHealthCheck(runner);
      } catch {
        // handled by runner
      }

      const passed = runner.report(opts.output);
      process.exit(passed ? 0 : 1);
    });
}
