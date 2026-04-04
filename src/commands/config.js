/**
 * marty config — view and set configuration.
 */

import { loadConfig, saveConfig, getConfigDir } from '../lib/config.js';
import { getFormatter, withErrorHandler } from '../lib/output.js';

export function registerConfigCommands(program) {
  const cfg = program.command('config').description('View and set CLI configuration');

  cfg
    .command('show')
    .description('Show current configuration')
    .option('-o, --output <format>', 'Output format (table|json)', 'table')
    .action((opts) => {
      const config = loadConfig();
      const fmt = getFormatter(opts.output);
      fmt.print({ ...config, configDir: getConfigDir() });
    });

  cfg
    .command('set <key> <value>')
    .description('Set a configuration value (apiUrl, organizationId)')
    .action((key, value) => {
      const allowed = ['apiUrl', 'organizationId'];
      if (!allowed.includes(key)) {
        console.error(`Unknown key: ${key}. Allowed: ${allowed.join(', ')}`);
        process.exit(2);
      }
      saveConfig({ [key]: value });
      console.log(`${key} = ${value}`);
    });
}
