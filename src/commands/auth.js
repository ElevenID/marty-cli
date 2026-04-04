/**
 * marty auth — login, logout, whoami
 */

import { Command } from 'commander';
import { loginWithApiKey, loginWithClientCredentials, logout, whoami } from '../lib/auth.js';
import { getFormatter, withErrorHandler } from '../lib/output.js';
import { ask, select, isInteractive } from '../lib/prompt.js';

export function registerAuthCommands(program) {
  const auth = program.command('auth').description('Manage authentication');

  auth
    .command('login')
    .description('Authenticate with the Marty platform')
    .option('--api-key <key>', 'Login with an API key')
    .option('--client-id <id>', 'OAuth2 client ID')
    .option('--client-secret <secret>', 'OAuth2 client secret')
    .option('--token-url <url>', 'Override the token endpoint URL')
    .action(withErrorHandler(async (opts) => {
      if (opts.apiKey) {
        loginWithApiKey(opts.apiKey);
        console.log('Logged in with API key.');
        return;
      }

      if (opts.clientId && opts.clientSecret) {
        await loginWithClientCredentials({
          clientId: opts.clientId,
          clientSecret: opts.clientSecret,
          tokenUrl: opts.tokenUrl,
        });
        console.log('Logged in with client credentials.');
        return;
      }

      // Interactive mode — guide the user through login
      if (!isInteractive()) {
        console.error('Provide --api-key or both --client-id and --client-secret.');
        process.exit(2);
      }

      const method = await select('How would you like to authenticate?', [
        { value: 'api_key', label: 'API Key' },
        { value: 'client_credentials', label: 'Client Credentials (OAuth2)' },
      ], { display: (c) => c.label });

      if (method.value === 'api_key') {
        const key = await ask('API Key');
        if (!key) { console.error('API key cannot be empty.'); process.exit(2); }
        loginWithApiKey(key);
        console.log('Logged in with API key.');
      } else {
        const clientId = await ask('Client ID');
        const clientSecret = await ask('Client Secret');
        const tokenUrl = await ask('Token URL (leave blank for default)');
        if (!clientId || !clientSecret) {
          console.error('Client ID and secret are required.');
          process.exit(2);
        }
        await loginWithClientCredentials({
          clientId,
          clientSecret,
          tokenUrl: tokenUrl || undefined,
        });
        console.log('Logged in with client credentials.');
      }
    }));

  auth
    .command('logout')
    .description('Clear stored credentials')
    .action(() => {
      logout();
      console.log('Logged out.');
    });

  auth
    .command('whoami')
    .description('Show current authentication status')
    .option('-o, --output <format>', 'Output format (table|json)', 'table')
    .action((opts) => {
      const info = whoami();
      if (!info) {
        console.log('Not logged in. Run: marty auth login');
        return;
      }
      const fmt = getFormatter(opts.output);
      fmt.print(info);
    });
}
