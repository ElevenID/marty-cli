/**
 * marty init — guided first-time setup.
 *
 * Walks the user through:
 *   1. API URL configuration
 *   2. Authentication (API key or client credentials)
 *   3. Organization selection
 *   4. Writes ~/.marty/config.json + credentials.json
 */

import { loadConfig, saveConfig, getConfigDir } from '../lib/config.js';
import { loginWithApiKey, loginWithClientCredentials, isLoggedIn, whoami } from '../lib/auth.js';
import { get } from '../lib/apiAdapter.js';
import { withErrorHandler, fail } from '../lib/output.js';
import { ask, select, confirm, isInteractive } from '../lib/prompt.js';

export function registerInitCommand(program) {
  program
    .command('init')
    .description('Interactive first-time setup — configure API, auth, and organization')
    .option('--api-url <url>', 'API base URL (skip prompt)')
    .option('--api-key <key>', 'API key (skip auth prompt)')
    .action(withErrorHandler(async (opts) => {
      if (!isInteractive() && !opts.apiKey) {
        fail('marty init requires an interactive terminal, or pass --api-key');
      }

      console.log('');
      console.log('  Welcome to the Marty CLI setup wizard.');
      console.log(`  Config will be stored in ${getConfigDir()}/`);
      console.log('');

      // ── Step 1: API URL ────────────────────────────────────────

      const current = loadConfig();
      let apiUrl = opts.apiUrl;
      if (!apiUrl && isInteractive()) {
        apiUrl = await ask('API base URL', { defaultValue: current.apiUrl });
      }
      apiUrl = apiUrl || current.apiUrl;
      saveConfig({ apiUrl });
      console.log(`  API URL: ${apiUrl}`);

      // ── Step 2: Authentication ─────────────────────────────────

      if (opts.apiKey) {
        loginWithApiKey(opts.apiKey);
        console.log('  Authenticated with API key.');
      } else if (!isLoggedIn()) {
        const method = await select('Authentication method:', [
          { value: 'api_key', label: 'API Key' },
          { value: 'client_credentials', label: 'Client Credentials (OAuth2)' },
          { value: 'skip', label: 'Skip (configure later)' },
        ], { display: (c) => c.label });

        if (method.value === 'api_key') {
          const key = await ask('API Key');
          if (key) {
            loginWithApiKey(key);
            console.log('  Authenticated with API key.');
          }
        } else if (method.value === 'client_credentials') {
          const clientId = await ask('Client ID');
          const clientSecret = await ask('Client Secret');
          const tokenUrl = await ask('Token URL (leave blank for default)');
          if (clientId && clientSecret) {
            await loginWithClientCredentials({
              clientId,
              clientSecret,
              tokenUrl: tokenUrl || undefined,
            });
            console.log('  Authenticated with client credentials.');
          }
        } else {
          console.log('  Skipping authentication. Run "marty auth login" later.');
        }
      } else {
        const info = whoami();
        console.log(`  Already authenticated (${info?.type || 'unknown'}).`);
      }

      // ── Step 3: Organization ───────────────────────────────────

      if (isLoggedIn()) {
        let skipOrg = false;
        try {
          const data = await get('/v1/organizations');
          const orgs = Array.isArray(data) ? data : data?.organizations || [];

          if (orgs.length === 0) {
            console.log('  No organizations found.');
            skipOrg = true;
          } else if (orgs.length === 1) {
            saveConfig({ organizationId: orgs[0].id });
            console.log(`  Organization: ${orgs[0].name || orgs[0].id}`);
          } else {
            const chosen = await select('Select your organization:', orgs, {
              display: (o) => `${o.name || o.id}${o.role ? ` (${o.role})` : ''}`,
            });
            saveConfig({ organizationId: chosen.id });
            console.log(`  Organization: ${chosen.name || chosen.id}`);
          }
        } catch {
          console.log('  Could not fetch organizations (check API URL and auth).');
          skipOrg = true;
        }
      }

      // ── Done ───────────────────────────────────────────────────

      console.log('');
      console.log('  Setup complete! Try:');
      console.log('    marty health');
      console.log('    marty credentials list');
      console.log('    marty applications list');
      console.log('');
    }));
}
